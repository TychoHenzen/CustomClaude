---
id: observability
purpose: Proactive logging guidance, levels, content rules, logs-as-proof.
when-to-include: when the work writes or changes runnable code
min-strictness: full
domains: [web, ml, cli, data, generic]
backends: all
layers: []
---
## Observability

### Add logging proactively

Don't wait to be asked. When writing or modifying non-trivial code, add logging at:

- **Public API / service boundaries** — request received, response sent, status code
- **State transitions** — status changes, lifecycle events, config loads
- **Error paths** — every catch/except block: log what failed and why
- **External calls** — DB queries, HTTP requests, file I/O: log before and after
- **Initialization** — service start, config loaded, flags resolved

### Where NOT to log

Hot paths produce noise. Do not add per-call logs inside tight loops, high-frequency handlers, render cycles, or hot cache lookups. Use counters/metrics instead.

### Log levels

| Level | When |
|-------|------|
| `ERROR` | Operation failed, user impact likely. Always actionable. |
| `WARN` | Recoverable issue, degraded behavior. |
| `INFO` | Significant milestone, state change, external call result. |
| `DEBUG` | Internal state, intermediate values. Default for new logs. |

### Log content rules

Always include operation name, relevant IDs, and outcome. Never log secrets, PII, raw bodies, or entire large objects.

Prefer structured (key=value / JSON fields) over interpolated strings.

<!-- @when strictness>=full -->
### Logging as proof

Logs are evidence. When you add a feature or fix a bug: add logs to the changed path, run it against the scenario, and include the log output in your completion message. A claim that "it works" is not evidence; log output showing it ran is.
<!-- @end -->
