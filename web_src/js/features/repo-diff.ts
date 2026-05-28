import {initRepoIssueContentHistory} from './repo-issue-content.ts';
import {initDiffFileTree} from './repo-diff-filetree.ts';
import {initDiffCommitSelect} from './repo-diff-commitselect.ts';
import {validateTextareaNonEmpty} from './comp/ComboMarkdownEditor.ts';
import {initViewedCheckboxListenerFor, initExpandAndCollapseFilesButton} from './pull-view-file.ts';
import {initImageDiff} from './imagediff.ts';
import {showErrorToast} from '../modules/toast.ts';
import {queryElemSiblings, hideElem, showElem, animateOnce, addDelegatedEventListener, createElementFromHTML, queryElems} from '../utils/dom.ts';
import {errorMessage} from '../modules/errors.ts';
import {POST, GET} from '../modules/fetch.ts';
import {createTippy} from '../modules/tippy.ts';
import {invertFileFolding} from './file-fold.ts';
import {parseDom} from '../utils.ts';
import {registerGlobalSelectorFunc} from '../modules/observer.ts';
import {performFetchActionTrigger} from './common-fetch-action.ts';
import {diffTreeStore, type DiffTreeEntry} from '../modules/diff-file.ts';

function initRepoDiffFileBox(el: HTMLElement) {
  // switch between "rendered" and "source", for image and CSV files
  queryElems(el, '.file-view-toggle', (btn) => btn.addEventListener('click', () => {
    queryElemSiblings(btn, '.file-view-toggle', (el) => el.classList.remove('active'));
    btn.classList.add('active');

    const target = document.querySelector(btn.getAttribute('data-toggle-selector')!);
    if (!target) throw new Error('Target element not found');

    hideElem(queryElemSiblings(target));
    showElem(target);
  }));
}

function initRepoDiffConversationForm() {
  // FIXME: there could be various different form in a conversation-holder (for example: reply form, edit form).
  // This listener is for "reply form" only, it should clearly distinguish different forms in the future.
  addDelegatedEventListener<HTMLFormElement, SubmitEvent>(document, 'submit', '.conversation-holder form', async (form, e) => {
    e.preventDefault();
    const textArea = form.querySelector<HTMLTextAreaElement>('textarea')!;
    if (!validateTextareaNonEmpty(textArea)) return;
    if (form.classList.contains('is-loading')) return;

    try {
      form.classList.add('is-loading');
      const formData = new FormData(form);

      // if the form is submitted by a button, append the button's name and value to the form data
      const submitter = e.submitter;
      const isSubmittedByButton = submitter instanceof HTMLButtonElement || (submitter instanceof HTMLInputElement && submitter.type === 'submit');
      if (isSubmittedByButton && submitter.name) {
        formData.append(submitter.name, submitter.value);
      }

      // on the diff page, the form is inside a "tr" and need to get the line-type ahead
      // but on the conversation page, there is no parent "tr"
      const trLineType = form.closest('tr')?.getAttribute('data-line-type');
      const response = await POST(form.getAttribute('action')!, {data: formData});
      const newConversationHolder = createElementFromHTML(await response.text());
      const path = newConversationHolder.getAttribute('data-path');
      const side = newConversationHolder.getAttribute('data-side');
      const idx = newConversationHolder.getAttribute('data-idx');

      form.closest('.conversation-holder')!.replaceWith(newConversationHolder);
      (form as any) = null; // prevent further usage of the form because it should have been replaced

      if (trLineType) {
        // if there is a line-type for the "tr", it means the form is on the diff page
        // then hide the "add-code-comment" [+] button for current code line by adding "tw-invisible" because the conversation has been added
        let selector;
        if (trLineType === 'same') {
          selector = `[data-path="${path}"] .add-code-comment[data-idx="${idx}"]`;
        } else {
          selector = `[data-path="${path}"] .add-code-comment[data-side="${side}"][data-idx="${idx}"]`;
        }
        for (const el of document.querySelectorAll(selector)) {
          el.classList.add('tw-invisible');
        }
      }

      // the default behavior is to add a pending review, so if no submitter, it also means "pending_review"
      if (!submitter || submitter?.matches('button[name="pending_review"]')) {
        const reviewBox = document.querySelector('#review-box')!;
        const counter = reviewBox?.querySelector('.review-comments-counter');
        if (!counter) return;
        const num = parseInt(counter.getAttribute('data-pending-comment-number')!) + 1 || 1;
        counter.setAttribute('data-pending-comment-number', String(num));
        counter.textContent = String(num);
        animateOnce(reviewBox, 'pulse-1p5-200');
      }
    } catch (error) {
      console.error('Error:', error);
      showErrorToast(`Submit form failed: ${errorMessage(error)}`);
    } finally {
      form?.classList.remove('is-loading');
    }
  });

  addDelegatedEventListener(document, 'click', '.resolve-conversation', async (el, e) => {
    e.preventDefault();
    const comment_id = el.getAttribute('data-comment-id')!;
    const origin = el.getAttribute('data-origin')!;
    const action = el.getAttribute('data-action')!;
    const url = el.getAttribute('data-update-url')!;

    try {
      const response = await POST(url, {data: new URLSearchParams({origin, action, comment_id})});
      const data = await response.text();

      const elConversationHolder = el.closest('.conversation-holder');
      if (elConversationHolder) {
        const elNewConversation = createElementFromHTML(data);
        elConversationHolder.replaceWith(elNewConversation);
      } else {
        window.location.reload();
      }
    } catch (error) {
      console.error('Error:', error);
    }
  });
}

function initRepoDiffConversationNav() {
  // Previous/Next code review conversation
  addDelegatedEventListener(document, 'click', '.previous-conversation, .next-conversation', (el, e) => {
    e.preventDefault();
    const isPrevious = el.matches('.previous-conversation');
    const elCurConversation = el.closest('.comment-code-cloud')!;
    const elAllConversations = document.querySelectorAll('.comment-code-cloud:not(.tw-hidden)');
    const index = Array.from(elAllConversations).indexOf(elCurConversation);
    const previousIndex = index > 0 ? index - 1 : elAllConversations.length - 1;
    const nextIndex = index < elAllConversations.length - 1 ? index + 1 : 0;
    const navIndex = isPrevious ? previousIndex : nextIndex;
    const elNavConversation = elAllConversations[navIndex];
    const anchor = elNavConversation.querySelector('.comment')!.id;
    window.location.href = `#${anchor}`;
  });
}

function initDiffHeaderPopup() {
  for (const btn of document.querySelectorAll('.diff-header-popup-btn:not([data-header-popup-initialized])')) {
    btn.setAttribute('data-header-popup-initialized', '');
    const popup = btn.nextElementSibling;
    if (!popup?.matches('.tippy-target')) throw new Error('Popup element not found');
    createTippy(btn, {
      content: popup,
      theme: 'menu',
      placement: 'bottom-end',
      trigger: 'click',
      interactive: true,
      hideOnClick: true,
    });
  }
}

// Will be called when the show more (files) button has been pressed
function onShowMoreFiles() {
  // TODO: replace these calls with the "observer.ts" methods
  initRepoIssueContentHistory();
  initViewedCheckboxListenerFor();
  initImageDiff();
  initDiffHeaderPopup();
}

async function loadMoreFiles(btn: Element): Promise<boolean> {
  if (btn.classList.contains('disabled')) {
    return false;
  }

  btn.classList.add('disabled');
  const url = btn.getAttribute('data-href')!;
  try {
    const response = await GET(url);
    const resp = await response.text();
    const respDoc = parseDom(resp, 'text/html');
    const respFileBoxes = respDoc.querySelector('#diff-file-boxes')!;
    // the response is a full HTML page, we need to extract the relevant contents:
    // * append the newly loaded file list items to the existing list
    const respFileBoxesChildren = Array.from(respFileBoxes.children); // "children:HTMLCollection" will be empty after replaceWith
    document.querySelector('#diff-incomplete')!.replaceWith(...respFileBoxesChildren);
    onShowMoreFiles();
    closeJumpGapIfBridged();
    return true;
  } catch (error) {
    console.error('Error:', error);
    showErrorToast('An error occurred while loading more files.');
  } finally {
    btn.classList.remove('disabled');
  }
  return false;
}

function initRepoDiffShowMore() {
  addDelegatedEventListener(document, 'click', 'a#diff-show-more-files', (el, e) => {
    e.preventDefault();
    loadMoreFiles(el);
  });

  addDelegatedEventListener<HTMLElement, MouseEvent>(document, 'click', 'a.jump-show-more-files', async (el, e) => {
    e.preventDefault();
    if (el.classList.contains('disabled')) return;
    const direction = el.getAttribute('data-direction');
    if (direction !== 'up' && direction !== 'down') return;
    el.classList.add('disabled');
    try {
      await loadJumpBatch(direction);
    } finally {
      el.classList.remove('disabled');
    }
  });

  addDelegatedEventListener(document, 'click', 'a.diff-load-button', async (el, e) => {
    e.preventDefault();
    if (el.classList.contains('disabled')) return;

    el.classList.add('disabled');
    const url = el.getAttribute('data-href')!;

    try {
      const response = await GET(url);
      const resp = await response.text();
      const respDoc = parseDom(resp, 'text/html');
      const respFileBody = respDoc.querySelector('#diff-file-boxes .diff-file-body .file-body')!;
      const respFileBodyChildren = Array.from(respFileBody.children); // "children:HTMLCollection" will be empty after replaceWith
      el.parentElement!.replaceWith(...respFileBodyChildren);
      // FIXME: calling onShowMoreFiles is not quite right here.
      // But since onShowMoreFiles mixes "init diff box" and "init diff body" together,
      // so it still needs to call it to make the "ImageDiff" and something similar work.
      onShowMoreFiles();
    } catch (error) {
      console.error('Error:', error);
    } finally {
      el.classList.remove('disabled');
    }
  });
}

async function onLocationHashChange() {
  // try to scroll to the target element by the current hash
  const currentHash = window.location.hash;
  if (!currentHash.startsWith('#diff-') && !currentHash.startsWith('#issuecomment-')) return;

  // avoid reentrance when we are changing the hash to scroll and trigger ":target" selection
  const attrAutoScrollRunning = 'data-auto-scroll-running';
  if (document.body.hasAttribute(attrAutoScrollRunning)) return;

  const targetElementId = currentHash.substring(1);
  while (currentHash === window.location.hash) {
    // use getElementById to avoid querySelector throws an error when the hash is invalid
    // eslint-disable-next-line unicorn/prefer-query-selector
    const targetElement = document.getElementById(targetElementId);
    if (targetElement) {
      // need to change hash to re-trigger ":target" CSS selector, let's manually scroll to it
      targetElement.scrollIntoView();
      document.body.setAttribute(attrAutoScrollRunning, 'true');
      window.location.hash = '';
      window.location.hash = currentHash;
      setTimeout(() => document.body.removeAttribute(attrAutoScrollRunning), 0);
      return;
    }

    // If looking for a hidden comment, try to expand the section that contains it
    const issueCommentPrefix = '#issuecomment-';
    if (currentHash.startsWith(issueCommentPrefix)) {
      const commentId = currentHash.substring(issueCommentPrefix.length);
      const expandButton = document.querySelector<HTMLElement>(`.code-expander-button[data-hidden-comment-ids*=",${commentId},"]`);
      if (expandButton) {
        // avoid infinite loop, do not re-click the button if already clicked
        const attrAutoLoadClicked = 'data-auto-load-clicked';
        if (expandButton.hasAttribute(attrAutoLoadClicked)) return;
        expandButton.setAttribute(attrAutoLoadClicked, 'true');
        // trigger the fetch action to load the hidden comments, after loading, it will try to find the target element again
        await performFetchActionTrigger(expandButton, 'load');
        continue; // Try again to find the element
      }
    }

    // #diff-<NameHash> outside the loaded slice: fast path via single block fetch,
    // replacing the cascading "Show More" loop (~12 round-trips for a 1200-file diff).
    if (currentHash.startsWith('#diff-')) {
      const nameHash = currentHash.substring('#diff-'.length);
      const entry = diffTreeStore().nameHashMap[nameHash];
      if (!entry) return;
      const ok = await loadFileBlock(entry);
      if (!ok) return;
      continue;
    }

    // the button will be refreshed after each "load more", so query it every time
    const showMoreButton = document.querySelector('#diff-show-more-files');
    if (!showMoreButton) {
      return; // nothing more to load
    }

    // Load more files, await ensures we don't block progress
    const ok = await loadMoreFiles(showMoreButton);
    if (!ok) return; // failed to load more files
  }
}

async function fetchFileBoxes(paths: string[]): Promise<Element[] | null> {
  const params = new URLSearchParams(window.location.search);
  params.set('file-only', 'true');
  params.delete('files');
  for (const p of paths) params.append('files', p);
  try {
    const response = await GET(`${window.location.pathname}?${params.toString()}`);
    if (!response.ok) {
      showErrorToast(`Failed to load file diff: ${response.status} ${response.statusText}`);
      return null;
    }
    const respDoc = parseDom(await response.text(), 'text/html');
    const respFileBoxes = respDoc.querySelector('#diff-file-boxes');
    if (!respFileBoxes) return null;
    return Array.from(respFileBoxes.children).filter(
      (el) => el.matches('.diff-file-box') && el.id !== 'diff-incomplete',
    );
  } catch (error) {
    console.error('fetchFileBoxes error:', error);
    showErrorToast(`Error loading file diff: ${errorMessage(error)}`);
    return null;
  }
}

// Jump section = jumped-to block + optional up/down buttons appended to #diff-file-boxes.
// No cached range state: the up button's next sibling is the first jump file, the down
// button's previous sibling is the last, and each box id (`diff-<NameHash>`) resolves
// to its entry.Index via the diff tree store.
const JUMP_UP_ID = 'diff-jump-incomplete-up';
const JUMP_DOWN_ID = 'diff-jump-incomplete-down';

function boxIndex(box: Element | null | undefined): number | undefined {
  if (!box?.id?.startsWith('diff-')) return undefined;
  return diffTreeStore().nameHashMap[box.id.substring('diff-'.length)]?.Index;
}

function makeJumpButton(id: string, direction: 'up' | 'down'): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'diff-file-box file-content tw-mt-2';
  wrapper.id = id;
  const h4 = document.createElement('h4');
  h4.className = 'ui top attached header tw-font-normal flex-left-right';
  const btn = document.createElement('a');
  btn.className = 'ui basic tiny button jump-show-more-files';
  btn.setAttribute('data-direction', direction);
  // Inherit the existing button's translated label rather than re-piping it through pageData.
  btn.textContent = document.querySelector('#diff-show-more-files')?.textContent?.trim() || 'Show More';
  h4.append(btn);
  wrapper.append(h4);
  return wrapper;
}

async function loadFileBlock(entry: DiffTreeEntry): Promise<boolean> {
  const store = diffTreeStore();
  if (entry.Index === undefined) return false;

  // Align to the same MaxGitDiffFiles grid as the main flow (e.g. file #835, max=100 → 800..899)
  // so jump and main loads are either disjoint or fully overlapping — no partial-overlap math.
  const max = window.config.pageData.MaxGitDiffFiles!;
  const total = store.entriesByIndex.length;
  const blockStart = Math.floor(entry.Index / max) * max;
  const blockEnd = Math.min(blockStart + max, total);
  const paths = store.entriesByIndex.slice(blockStart, blockEnd).map((e) => e.FullName);

  const boxes = await fetchFileBoxes(paths);
  if (!boxes || !boxes.length) return false;

  const container = document.querySelector('#diff-file-boxes');
  if (!container) return false;
  clearDetachedJumpSection(container);

  if (blockStart > 0) container.append(makeJumpButton(JUMP_UP_ID, 'up'));
  container.append(...boxes);
  if (blockEnd < total) container.append(makeJumpButton(JUMP_DOWN_ID, 'down'));

  onShowMoreFiles();
  closeJumpGapIfBridged();
  return true;
}

// On re-jump: if the previous section's up button is still here, its files are disjoint
// from main and get removed; otherwise they've merged into main and stay.
function clearDetachedJumpSection(container: Element) {
  const upBtn = container.querySelector(`#${JUMP_UP_ID}`);
  const downBtn = container.querySelector(`#${JUMP_DOWN_ID}`);

  if (upBtn) {
    let node = upBtn.nextElementSibling;
    while (node && node !== downBtn) {
      const next = node.nextElementSibling;
      node.remove();
      node = next;
    }
  }
  upBtn?.remove();
  downBtn?.remove();
}

async function loadJumpBatch(direction: 'up' | 'down'): Promise<void> {
  const container = document.querySelector<HTMLElement>('#diff-file-boxes');
  if (!container) return;
  const store = diffTreeStore();
  const total = store.entriesByIndex.length;
  const max = window.config.pageData.MaxGitDiffFiles!;
  const buttonId = direction === 'up' ? JUMP_UP_ID : JUMP_DOWN_ID;
  const button = container.querySelector(`#${buttonId}`);
  if (!button) return;

  let sliceStart: number, sliceEnd: number; // half-open [sliceStart, sliceEnd)
  if (direction === 'up') {
    const firstIdx = boxIndex(button.nextElementSibling);
    if (firstIdx === undefined || firstIdx <= 0) return;
    sliceStart = Math.max(0, firstIdx - max);
    sliceEnd = firstIdx;
  } else {
    const lastIdx = boxIndex(button.previousElementSibling);
    if (lastIdx === undefined || lastIdx >= total - 1) return;
    sliceStart = lastIdx + 1;
    sliceEnd = Math.min(total, sliceStart + max);
  }

  const paths = store.entriesByIndex.slice(sliceStart, sliceEnd).map((e) => e.FullName);
  const boxes = await fetchFileBoxes(paths);
  if (!boxes) return;
  // Button may have been removed (or section cleared) during await.
  const liveButton = container.querySelector(`#${buttonId}`);
  if (!liveButton) return;
  if (direction === 'up') liveButton.after(...boxes);
  else liveButton.before(...boxes);
  if (direction === 'up' && sliceStart <= 0) container.querySelector(`#${buttonId}`)?.remove();
  if (direction === 'down' && sliceEnd >= total) container.querySelector(`#${buttonId}`)?.remove();
  onShowMoreFiles();
  closeJumpGapIfBridged();
}

// When main's tail meets jump's head, the up button and main `#diff-incomplete` are both redundant.
function closeJumpGapIfBridged() {
  const container = document.querySelector('#diff-file-boxes');
  if (!container) return;
  const upBtn = container.querySelector(`#${JUMP_UP_ID}`);
  if (!upBtn) return;
  const firstIdx = boxIndex(upBtn.nextElementSibling);
  if (firstIdx === undefined || firstIdx <= 0) return;
  const prev = diffTreeStore().entriesByIndex[firstIdx - 1];
  if (!prev?.NameHash || !container.querySelector(`#diff-${CSS.escape(prev.NameHash)}`)) return;
  upBtn.remove();
  container.querySelector('#diff-incomplete')?.remove();
}

function initRepoDiffHashChangeListener() {
  window.addEventListener('hashchange', onLocationHashChange);
  onLocationHashChange();
}

export function initRepoDiffView() {
  initRepoDiffConversationForm(); // such form appears on the "conversation" page and "diff" page

  if (!document.querySelector('#diff-file-boxes')) return;
  initRepoDiffConversationNav(); // "previous" and "next" buttons only appear on "diff" page
  initDiffFileTree();
  initDiffCommitSelect();
  initRepoDiffShowMore();
  initDiffHeaderPopup();
  initViewedCheckboxListenerFor();
  initExpandAndCollapseFilesButton();
  initRepoDiffHashChangeListener();

  registerGlobalSelectorFunc('#diff-file-boxes .diff-file-box', initRepoDiffFileBox);
  addDelegatedEventListener(document, 'click', '.fold-file', (el) => {
    invertFileFolding(el.closest('.file-content')!, el);
  });
}
