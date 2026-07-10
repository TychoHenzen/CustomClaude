---
id: code-review-gates
purpose: Gate review findings on evidence; reject manufactured nits and false positives.
when-to-include: when reviewing code
min-strictness: full
domains: all
backends: all
layers: []
---
## Code Review Gates

Before reporting ANY review finding, answer four questions:

1. Can I cite the exact line?
2. Can I describe the concrete failure mode (input → state → bad outcome)?
3. Have I read surrounding context (callers, imports, tests)?
4. Is the severity defensible?

Any "no" or "unsure" → downgrade or drop.

**Zero findings is valid.** Clean review = valid review. Do not manufacture findings. Manufactured nits, speculative "consider using X", and hypothetical edge cases without a trigger are the primary failure mode of LLM reviewers.

<!-- @when strictness>=full -->
### False positives — skip unless codebase-specific evidence

- "Add error handling" when the caller already handles it
- "Magic number" for well-known constants (200, 404, 1024)
- "Function too long" for switch/match statements or config objects
- "Missing docs" on self-describing helpers
- "Hardcoded value" in test fixtures
<!-- @end -->
