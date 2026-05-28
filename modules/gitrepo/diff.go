// Copyright 2025 The Gitea Authors. All rights reserved.
// SPDX-License-Identifier: MIT

package gitrepo

import (
	"bytes"
	"context"
	"io"

	"code.gitea.io/gitea/modules/git/gitcmd"
)

// GetDiffShortStatByCmdArgs counts changed files without calculating line-level diff stats.
func GetDiffShortStatByCmdArgs(ctx context.Context, repo Repository, trustedArgs gitcmd.TrustedCmdArgs, dynamicArgs ...string) (numFiles, totalAdditions, totalDeletions int, err error) {
	cmd := gitcmd.NewCommand("diff", "--name-only", "-z").AddArguments(trustedArgs...).AddDynamicArguments(dynamicArgs...)
	stdout, _, err := RunCmdBytes(ctx, repo, cmd)
	if err != nil {
		return 0, 0, 0, err
	}
	return bytes.Count(stdout, []byte{0}), 0, 0, nil
}

// GetReverseRawDiff dumps the reverse diff results of repository in given commit ID to io.Writer.
func GetReverseRawDiff(ctx context.Context, repo Repository, commitID string, writer io.Writer) error {
	return RunCmdWithStderr(ctx, repo, gitcmd.NewCommand("show", "--pretty=format:revert %H%n", "-R").
		AddDynamicArguments(commitID).
		WithStdoutCopy(writer),
	)
}
