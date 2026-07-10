---
id: code-quality
purpose: Scope discipline plus quantified complexity thresholds and comment policy.
when-to-include: always
min-strictness: lean
domains: all
backends: all
layers: []
---
## Code Quality

### Scope discipline

- No features/refactoring/abstractions beyond task
- No "improving" adjacent code
- No error handling for impossible scenarios
- No type annotations/docstrings/formatting on unchanged code
- Three similar lines > premature abstraction
- Unused code → delete. No compat shims, `_unused` renames, tombstones

<!-- @when strictness>=full -->
### Quantified thresholds

| Metric | Limit | Action |
|--------|-------|--------|
| Function length | >`<LANG_FN_LINE_LIMIT>` lines | Split |
| File length | >`<LANG_FILE_LINE_LIMIT>` lines | Extract module |
| Nesting depth | >4 levels | Early returns / extract |
| Cyclomatic complexity | >10 per function | Decompose |

Apply to code you write. Flag in code you review. Don't refactor existing code to meet these unless that's the task.
<!-- @end -->

### Comments

Default: none. Only when WHY is non-obvious — hidden constraint, subtle invariant, workaround. Never explain WHAT. Never reference task/ticket/PR.
