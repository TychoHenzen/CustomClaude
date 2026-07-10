---
id: scope-orchestration-routing
purpose: Match planning depth to task complexity; route to subagents when warranted.
when-to-include: medium+ complexity work
min-strictness: full
domains: all
backends: all
layers: []
---
## Scope-to-Orchestration Routing

| Complexity | Signal | Execution |
|-----------|--------|-----------|
| Trivial | Single file, <10 lines, obvious | Direct |
| Small | 1-2 files, clear scope | Single skill |
| Medium | 3-5 files, design decisions | Skill chain |
| Large | Multi-file, architectural | Phased plan |
| Epic | Multi-PR, cross-cutting | Blueprint + subagents |

Don't over-plan trivial work. Don't under-plan complex work.
