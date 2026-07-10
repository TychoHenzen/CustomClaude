---
id: completion-protocol
purpose: Definition of done, TDD-first mandate, anti-stub rules, pre-completion audit.
when-to-include: always
min-strictness: lean
domains: all
backends: all
layers: []
---
## Completion Protocol

### Definition of done

ALL true, each verified by command:

1. **Tests cover behavior** — every new/changed public function tested with real inputs and real assertions.
2. **All tests pass** — run `<LANG_TEST_CMD>`, full suite, not a subset.
3. **No banned patterns** — grep changed files for stubs (`<LANG_STUB_KEYWORDS>`). Zero matches.
4. **Build clean** — `<LANG_BUILD_CMD>` exits 0, no new warnings.
5. **Diff small and focused** — re-read diff. Revert any hunk not directly required.

ANY fails → not done. Fix first.

### Anti-stub rules

BANNED in code reported as complete: placeholder keywords (`<LANG_STUB_KEYWORDS>`), marker comments (`// TODO`, `// FIXME`, `// HACK`), empty bodies where logic is expected, hardcoded dummy returns standing in for real logic, future-tense "will be implemented" comments.

**Enforcement:** before reporting done, grep changed files for stubs (`<LANG_STUB_KEYWORDS>`). Any match → not done.

**Exception:** stubs allowed ONLY when the user explicitly asked for a scaffold/skeleton.

<!-- @when strictness>=full -->
### TDD-first mandate

**Applies to:** feature work, bug fixes, new modules, behavior-changing refactors.
**Skip for:** renames, config, docs, one-line fixes with existing tests.

Non-negotiable sequence:

1. **Write test first.** Describes what code should do, not what it does.
2. **Run test. Show failing output (RED).** Failure must be from intended missing behavior — not syntax errors.
3. **Implement minimum** to pass. Not elegant. Not general.
4. **Run test. Show passing output (GREEN).**
5. **Refactor only code you just wrote.** Green tests only.
<!-- @end -->

<!-- @when strictness>=full -->
### Pre-completion audit

Before ANY "done"/"complete"/"finished" message, run each check and paste the actual output:

```
AUDIT:
[✓/✗] Tests cover behavior   → <test names + what each asserts>
[✓/✗] All tests pass         → $ <LANG_TEST_CMD>  → exit code: <N>
[✓/✗] No banned patterns     → $ grep stubs (<LANG_STUB_KEYWORDS>) → <no output = clean>
[✓/✗] Build clean            → $ <LANG_BUILD_CMD> → exit code: <N>, warnings: <N>
[✓/✗] Diff focused           → <N lines changed, no unrelated hunks>
```

**Output is evidence. Claims are not.** Paste real output. Any ✗ → fix, re-audit.
<!-- @end -->

<!-- @when strictness=paranoid -->
### Checkpoint reachability

Each TDD checkpoint commit must be reachable from HEAD on the active branch and belong to the current task. Commits from other branches or unrelated work don't count as evidence.
<!-- @end -->
