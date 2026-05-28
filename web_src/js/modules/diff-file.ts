import {reactive} from 'vue';
import type {Reactive} from 'vue';

const {pageData} = window.config;

export type DiffStatus = '' | 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'typechange';

export type DiffTreeEntry = {
  FullName: string,
  DisplayName: string,
  NameHash: string,
  DiffStatus: DiffStatus,
  EntryMode: string,
  IsViewed: boolean,
  Children: DiffTreeEntry[] | null,
  FileIcon: string,
  ParentEntry?: DiffTreeEntry,
  // Position in the depth-first flattened leaf list (entriesByIndex). Set for
  // leaves only; directory nodes leave it undefined.
  Index?: number,
};

export type DiffFileTreeData = {
  TreeRoot: DiffTreeEntry,
};

type DiffFileTree = {
  folderIcon: string;
  folderOpenIcon: string;
  diffFileTree: DiffFileTreeData;
  fullNameMap: Record<string, DiffTreeEntry>;
  // Reverse lookup of NameHash -> entry. The diff page uses `#diff-<NameHash>`
  // anchors but the server-side single-file fetch endpoint takes file paths,
  // so we need to translate one to the other on hash navigation.
  nameHashMap: Record<string, DiffTreeEntry>;
  // Depth-first flattened list of file entries (leaves only), in diff order.
  // The jump section's up/down "Show More" buttons slice this around the
  // currently loaded range to fetch adjacent batches by path. Each leaf's
  // position is also stored on the entry itself as `Index`.
  entriesByIndex: DiffTreeEntry[];
  fileTreeIsVisible: boolean;
  selectedItem: string;
};

let diffTreeStoreReactive: Reactive<DiffFileTree>;
export function diffTreeStore() {
  if (!diffTreeStoreReactive) {
    diffTreeStoreReactive = reactiveDiffTreeStore(pageData.DiffFileTree!, pageData.FolderIcon!, pageData.FolderOpenIcon!);
  }
  return diffTreeStoreReactive;
}

export function diffTreeStoreSetViewed(store: Reactive<DiffFileTree>, fullName: string, viewed: boolean) {
  const entry = store.fullNameMap[fullName];
  if (!entry) return;
  entry.IsViewed = viewed;
  for (let parent = entry.ParentEntry; parent; parent = parent.ParentEntry) {
    parent.IsViewed = isEntryViewed(parent);
  }
}

function fillMaps(
  fullNameMap: Record<string, DiffTreeEntry>,
  nameHashMap: Record<string, DiffTreeEntry>,
  entriesByIndex: DiffTreeEntry[],
  entry: DiffTreeEntry,
) {
  fullNameMap[entry.FullName] = entry;
  if (!entry.Children) {
    // Leaf node = an actual file. Only leaves get a non-empty NameHash (see
    // routers/web/repo/treelist.go); directory nodes are skipped.
    if (entry.NameHash) {
      nameHashMap[entry.NameHash] = entry;
      entry.Index = entriesByIndex.length;
      entriesByIndex.push(entry);
    }
    return;
  }
  entry.IsViewed = isEntryViewed(entry);
  for (const child of entry.Children) {
    child.ParentEntry = entry;
    fillMaps(fullNameMap, nameHashMap, entriesByIndex, child);
  }
}

export function reactiveDiffTreeStore(data: DiffFileTreeData, folderIcon: string, folderOpenIcon: string): Reactive<DiffFileTree> {
  const store = reactive({
    diffFileTree: data,
    folderIcon,
    folderOpenIcon,
    fileTreeIsVisible: false,
    selectedItem: '',
    fullNameMap: {},
    nameHashMap: {},
    entriesByIndex: [],
  });
  fillMaps(store.fullNameMap, store.nameHashMap, store.entriesByIndex, data.TreeRoot);
  return store;
}

function isEntryViewed(entry: DiffTreeEntry): boolean {
  if (entry.Children) {
    let count = 0;
    for (const child of entry.Children) {
      if (child.IsViewed) count++;
    }
    return count === entry.Children.length;
  }
  return entry.IsViewed;
}
