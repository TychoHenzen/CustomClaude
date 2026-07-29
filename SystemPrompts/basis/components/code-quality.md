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

### Structure gate

A hook scans every file you write. It compares that file against a recorded
baseline, not against an absolute bound.

- A tracked file may not raise the count of any error-severity rule. Old debt
  never blocks. New debt always blocks.
- A new file passes unless a metric goes past 1.5 times the hard bound.
- Hard bounds: line 120, file 300 lines, function 60 lines, complexity 10,
  7 parameters, nesting depth 5, one type per file.
- Also blocked: unnamed tuples, unused locals, commented-out code.
- The repository linter runs first when the repository configures one.

Write to the preferred bounds, not the hard ones. Line 80, file 100 lines,
function 30 lines, complexity 5, 3 parameters, nesting depth 3.

### Comments

Default: none. Only when WHY is non-obvious — hidden constraint, subtle invariant, workaround. Never explain WHAT. Never reference task/ticket/PR.
