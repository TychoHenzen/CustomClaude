## Code structure: ratchet, not absolute

`quality-guard` scans every code file I write. It compares that file against a
recorded baseline in `.quality-baseline.json` at the repository root.

- A tracked file may not raise the count of any error-severity rule. Old debt
  never blocks. New debt always blocks.
- A new file passes unless a metric goes past 1.5 times the hard bound.
- The first write to a repository with no baseline records one and passes.
- Hard bounds: line 120, file 300 lines, function 60 lines, complexity 10,
  7 parameters, nesting depth 5, one type per file. Also no unnamed tuple, no
  unused local, no commented-out code.
- Write to the preferred bounds: line 80, file 100 lines, function 30 lines,
  complexity 5, 3 parameters, nesting depth 3.

The repository linter runs first when the repository configures one. Only
`eslint` and `ruff` run, because they check one file fast. Clippy and
`dotnet format` work on a whole crate or solution, so Rust and C# get the
structural rules alone.

Run the scanner directly on a path:

```bash
node ~/.claude/plugins/marketplaces/dod-guard/packages/dod-guard/skills/quality-refactor/scripts/quality-scan.mjs src --root=.
```

Put `quality-guard: off` in the first lines of a file to exempt it. Set
`QUALITY_GUARD=off` to disable every check.
