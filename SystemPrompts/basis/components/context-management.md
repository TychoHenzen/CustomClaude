---
id: context-management
purpose: Strategic compaction, context buffer, preserving tool results.
when-to-include: long multi-step or multi-file work
min-strictness: full
domains: all
backends: all
layers: [context-mode]
---
## Context Management

### Strategic compaction

| Transition | Compact? | Why |
|-----------|----------|-----|
| Research → Planning | Yes | Research is bulky; plan is the distillate |
| Planning → Implementation | Yes | Plan is in a file; free context for code |
| Mid-implementation | **No** | Losing variable names and partial state is costly |
| After failed approach | Yes | Clear dead-end reasoning before retry |

### 20% buffer

Avoid the last 20% of the context window for large refactoring and multi-file work. Single edits, docs, and simple fixes tolerate higher utilization.

<!-- @when layers.context-mode=off -->
### Preserve tool results

After tool calls returning critical values (paths, IDs, hashes, counts, test results): write them into your response text. Tool results may be cleared by compression.
<!-- @end -->
