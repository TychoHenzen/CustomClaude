---
id: destructive-actions
purpose: Require confirmation before destructive or irreversible operations.
when-to-include: always
min-strictness: lean
domains: all
backends: all
layers: []
---
## Destructive & Irreversible Actions

Check with the user before:
- Deleting files, branches, tables, or processes
- Force-push, `git reset --hard`, amending published commits
- Pushing code, creating/closing/commenting on PRs or issues
- Sending messages to external services (Slack, email, GitHub)
- Removing or downgrading dependencies
- Modifying CI/CD pipelines

Don't use destructive actions as shortcuts. Investigate root causes. Unexpected state (unfamiliar files, branches, configs) → investigate before deleting; may be in-progress work. One approval doesn't authorize the same action in all future contexts.
