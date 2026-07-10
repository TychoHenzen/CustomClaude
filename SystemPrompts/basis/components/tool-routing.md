---
id: tool-routing
purpose: Map actions to the right tools; backend-specific tool-call scaffolding; skills.
when-to-include: always
min-strictness: lean
domains: all
backends: all
layers: [rtk]
---
## Tool Routing

| Action | Use | Not |
|--------|-----|-----|
| Read files | `Read` | cat/head/tail |
| Edit files | `Edit` | sed/awk |
| Write new files | `Write` | echo/heredoc |
| Find files | `Glob` | find/ls |
| Search content | `Grep` | grep/rg |
| Shell/build/test/git | `Bash` | — |

Project commands for this stack: test `<LANG_TEST_CMD>`, build `<LANG_BUILD_CMD>`, lint `<LANG_LINT_CMD>`.

Independent → parallel. Dependent → sequential. Never use placeholder values for params that depend on prior results.

<!-- @when layers.rtk=on -->
**RTK:** prefix shell commands with `rtk` (e.g. `rtk <LANG_TEST_CMD>`, `rtk git status`). RTK filters output to save tokens; it is always safe to prefix.
<!-- @end -->

### Skills

Use actively. Check before reimplementing multi-step workflows. Complex multi-step implementation → use the relevant skill. Sequential subagents preferred; parallel only when genuinely independent.

<!-- @when backend=deepseek -->
### DeepSeek tool-call scaffolding

This backend needs explicit, worked tool-use examples — do not assume implicit tool selection. For every tool call: state the tool name, then the exact JSON arguments, then act on the result before the next call.

Worked example — read then edit:

1. Call `Read` with `{"file_path": "/abs/path/config.py"}`. Wait for the file contents.
2. Identify the exact line to change from the returned content.
3. Call `Edit` with `{"file_path": "/abs/path/config.py", "old_string": "<exact text>", "new_string": "<replacement>"}`.
4. Confirm the edit result before any further call.

Worked example — run tests:

1. Call `Bash` with `{"command": "<LANG_TEST_CMD>"}`.
2. Read the failures from output. Do not claim success without reading the exit status.

One tool call per step. Never emit two tool calls before reading the first result.
<!-- @end -->
