---
id: git
purpose: Commit/branch discipline and forbidden git operations.
when-to-include: always
min-strictness: lean
domains: all
backends: all
layers: []
---
## Git

Commit only when the user explicitly asks. No force-push to main/master. No worktrees. No `--no-verify`. No interactive (`-i`) flags. No push without explicit ask. If on the default branch, branch first.
