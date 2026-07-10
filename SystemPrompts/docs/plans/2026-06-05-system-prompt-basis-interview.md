# Tunable Dev System-Prompt Basis + Generator — Requirements Spec

> **For Claude (/goal):** Work through each incomplete step below.
> 1. Mark a step `[>]` when you begin working on it.
> 2. Verify each proof by running the stated command/process and confirming the expected outcome.
> 3. Mark each proof `[x]` only when the claim has been tested and matches the expected value.
> 4. A step may only be marked `[x]` once ALL its proofs are `[x]` or `[~]`.
> 5. If a proof cannot be met because requirements changed or the original condition is unreasonable:
>    - Mark it `[~]` with the original condition struck through.
>    - Add a bullet underneath: `  - Met instead: [what was actually achieved]`
>    - The step can still be `[x]` once all proofs are resolved (either `[x]` or `[~]`).
> 6. Continue until every step is `[x]` — then stop and report done.
>
> **Self-contained.** No external context needed. Run the commands listed in proofs directly.

**Goal:** Build a modular, tunable component library that a generator skill consumes to produce Claude-Code development system prompts on demand — e.g. invoking "create a system prompt based on rme-strict tuned toward python web development, full strictness, deepseek backend".

**Date:** 2026-06-05

---

## Requirements

### Deliverable form
- **Modular component library** at `.claude/SystemPrompts/basis/`.
- One component file per logical prompt section. Backbone sections (derived from rme-strict v1→v3, which survived all three revisions):
  `identity`, `prime-directives`, `communication`, `reading-before-acting`, `code-quality`, `observability`, `completion-protocol`, `ownership`, `code-review-gates`, `context-management`, `scope-orchestration-routing`, `security`, `tool-routing`, `destructive-actions`, `git`, `what-you-are-not`.
- Each component carries frontmatter: `id`, `purpose`, `when-to-include`, `min-strictness`, `domains` (list or `all`), `backends` (list or `all`), `layers` (which always-on layers make parts of it redundant).
- A **manifest** (`basis/manifest.yaml` or `.json`) indexing all components + an **assembly order**.
- A **generator skill** that resolves a natural-language assembly request into a filled prompt.

### Five tuning axes — pinned mechanisms
Axes are NOT uniform. Two mechanisms:

1. **Placeholder swap** — Language axis only.
   - Tokens like `<LANG_TEST_CMD>`, `<LANG_BUILD_CMD>`, `<LANG_LINT_CMD>`, `<LANG_STUB_KEYWORDS>`, `<LANG_FN_LINE_LIMIT>`, `<LANG_FILE_LINE_LIMIT>` embedded in components.
   - Resolved from `basis/values/languages.yaml` (per-language table: python/rust/ts/go).
   - Example: python → `<LANG_TEST_CMD>` = `pytest`, `<LANG_STUB_KEYWORDS>` = `pass,raise NotImplementedError,...`.

2. **Conditional content** — Domain, Strictness, Backend, Layers.
   - In-component conditional blocks using a directive syntax (HTML comments so raw component is still readable markdown):
     ```
     <!-- @when strictness>=full -->
     ...content included only at full+ strictness...
     <!-- @end -->
     <!-- @when backend=deepseek -->
     ...explicit tool-use scaffolding + worked examples...
     <!-- @end -->
     <!-- @when layers.liedetector=off -->
     - No emoji.
     <!-- @end -->
     ```
   - Section-level inclusion controlled by manifest fields (`min-strictness`, `domains`, `backends`): a whole component is dropped if config doesn't match.
   - Axes interact: e.g. `{strictness=lean, backend=deepseek}` strips ceremony sections AND injects the deepseek tool-scaffolding block. The generator must apply section-level (manifest) filtering first, then block-level (`@when`) filtering, then placeholder swap.

### Axis value vocabularies
- **Language:** `python`, `rust`, `typescript`, `go` (extensible via languages.yaml).
- **Domain:** `web`, `ml`, `cli`, `data`, `embedded`, `generic`.
- **Strictness:** `lean` < `full` < `paranoid` (ordered; `min-strictness` compares on this order).
- **Harness:** fixed `claude-code` (tool names, skills, no-worktree rule always assumed).
- **Backend:** `claude`, `deepseek`, `other`. `deepseek` adds tool-use scaffolding; `claude` omits it.

### Layer-coexistence toggle
- Always-on layers considered: `caveman`, `liedetector`, `rtk`, `context-mode`.
- Generator accepts a `layers` config (each on/off). When a layer is on, components strip the bits it already enforces:
  - `liedetector` on → strip standalone "no emoji" (tags use emoji).
  - `caveman` on → defer terseness rules (caveman already compresses).
  - `rtk` on → tool-routing prefixes commands with `rtk`; defer raw-command guidance.
  - `context-mode` on → defer "preserve tool results / large output" handling.
- Default config = all layers off (standalone, portable).

### Inputs to the build (internal, not shipped)
- The 3 `rme-strict` versions in `.claude/SystemPrompts/` — backbone + evolution signal.
- Full user setup (`~/.claude/CLAUDE.md`, RTK.md, caveman, liedetector, context-mode, skills/agents) — **eval is internal only; NO scorecard is shipped.**
- Public/known agent prompts — **fetch real ones** (Claude Code, Cursor, Aider, Cline, Windsurf, Codex) to extract section patterns the corpus lacks. **These are leaked/reverse-engineered, treat as reference patterns, not ground truth. No build step may assert fidelity to them.**

### Out of scope
- No shipped eval/scorecard of existing prompts.
- No modification of existing CLAUDE.md / RTK / caveman / liedetector / context-mode.
- No support for non-Claude-Code harnesses (harness axis is fixed).

## Research Notes

- **Corpus location:** `.claude/SystemPrompts/{rme-strict.md, rme-strict-v2.md, rme-strict-v3.md, blank.md}`. blank.md is empty.
- **Evolution:** v1 verbose baseline → v2 compressed + added Ownership, Code Review Gates, Context Mgmt, Scope→Orchestration Routing, Prompt Defense, quantified thresholds → v3 added Observability (logging) section + "logs as proof" in completion audit. **v3 ≈ the user's current active system prompt.**
- **Section list to componentize** = union of all v3 sections (see backbone list above).
- **Known internal conflicts** the layer toggle must resolve: prompt "no emoji" vs liedetector 🟢🟡 tags; prompt terseness vs caveman; tool-routing raw commands vs RTK prefixing; "preserve tool results" vs context-mode.
- **DeepSeek signal:** user reports DeepSeek-in-Claude-Code struggles with correct tool use → backend=deepseek must inject explicit tool-call scaffolding + worked examples; backend=claude omits.
- **Directive/placeholder conventions** chosen for readability: `<TOKEN>` for swaps, `<!-- @when ... -->...<!-- @end -->` for conditionals. A component with no directives is a valid plain-markdown section.
- **Generator skill** lives under `.claude/skills/` (standard skill location), reads `basis/manifest.*`, applies filtering pipeline (manifest filter → `@when` filter → placeholder swap → concatenate in assembly order).

## Open Questions

- Manifest format: YAML vs JSON — implementer's choice; pick one and be consistent. (Default: YAML for human-edit ergonomics.)
- Whether to add more languages/domains beyond the initial vocab — extensible by design, not required for done.

---

## Definition of Done

### Step 1: Scaffold basis directory + values tables

Create `.claude/SystemPrompts/basis/` with subdirs `components/`, `values/`, `evals/`, and `manifest.yaml`. Populate `values/languages.yaml` with python, rust, typescript, go entries covering all `<LANG_*>` tokens.

- [x] Proof: `Glob` `.claude/SystemPrompts/basis/**` → returns `components/`, `values/languages.yaml`, `evals/`, `manifest.yaml`.
- [x] Proof: read `values/languages.yaml` → contains top-level keys `python`, `rust`, `typescript`, `go`; each has `test_cmd`, `build_cmd`, `lint_cmd`, `stub_keywords`, `fn_line_limit`, `file_line_limit`.
- [x] Proof: `rtk grep "<LANG_TEST_CMD>" .claude/SystemPrompts/basis/values/languages.yaml` → no matches (table holds resolved values, not the token).

### Step 2: Define directive grammar + write it down

Document the assembly grammar in `basis/GRAMMAR.md`: the `<TOKEN>` swap list, the `<!-- @when EXPR -->...<!-- @end -->` syntax, the comparison operators for strictness (`>=`, `=`), layer expressions (`layers.<name>=on|off`), backend/domain equality, and the resolution pipeline order (manifest filter → @when filter → placeholder swap → concat).

- [x] Proof: read `basis/GRAMMAR.md` → documents all six `<LANG_*>` tokens, the `@when`/`@end` syntax, and the 4-stage pipeline order explicitly.
- [x] Proof: `rtk grep "@when" .claude/SystemPrompts/basis/GRAMMAR.md` → at least one example each for strictness, backend, domain, and layers conditions.

### Step 3: Author all backbone components with frontmatter + tuning hooks

For each of the 16 backbone sections, create `basis/components/<id>.md` with frontmatter (`id`, `purpose`, `when-to-include`, `min-strictness`, `domains`, `backends`, `layers`) and body using directives where the section varies by axis. Content derived from rme-strict v3 + public-prompt patterns (reference only). Must include: language placeholders in `completion-protocol`/`code-quality`/`tool-routing`; a `@when backend=deepseek` tool-scaffolding block in `tool-routing`; `@when layers.liedetector=off` for the emoji rule in `communication`; strictness conditionals in `completion-protocol` (audit/TDD ceremony) and `code-review-gates`.

- [x] Proof: `Glob` `.claude/SystemPrompts/basis/components/*.md` → exactly 16 files matching the backbone id list.
- [x] Proof: each component has YAML frontmatter with all 7 required keys → verify by reading 3 spot files (`completion-protocol.md`, `communication.md`, `tool-routing.md`); each shows all keys.
- [x] Proof: `rtk grep "@when backend=deepseek" .claude/SystemPrompts/basis/components/tool-routing.md` → ≥1 match.
- [x] Proof: `rtk grep "@when layers.liedetector=off" .claude/SystemPrompts/basis/components/communication.md` → ≥1 match, and the matched block contains an emoji/`no emoji` rule.
- [x] Proof: `rtk grep "<LANG_TEST_CMD>" .claude/SystemPrompts/basis/components/completion-protocol.md` → ≥1 match.
- [x] Proof: `rtk grep "@when strictness>=full" .claude/SystemPrompts/basis/components/completion-protocol.md` → ≥1 match (audit/TDD ceremony gated).

### Step 4: Build the manifest

Write `basis/manifest.yaml` listing all 16 components in assembly order, each entry mirroring its inclusion fields (`id`, `min-strictness`, `domains`, `backends`). Manifest is the section-level filter source of truth.

- [x] Proof: read `manifest.yaml` → contains an ordered list of exactly 16 component ids, each present as a file in `components/`.
- [x] Proof: cross-check → every `id` in `manifest.yaml` has a matching `components/<id>.md` and vice versa (no orphans). Verify by listing both and diffing.

### Step 5: Build the generator skill

Create `.claude/skills/sysprompt-gen/SKILL.md` (+ any helper script) implementing the resolution pipeline: parse an assembly request (language, domain, strictness, backend, layers), filter components by manifest, strip non-matching `@when` blocks, swap `<LANG_*>` tokens from `languages.yaml`, concatenate in manifest order, output a single prompt. Must reject unknown axis values with a clear error.

- [x] Proof: `Glob` `.claude/skills/sysprompt-gen/**` → `SKILL.md` exists.
- [x] Proof: read `SKILL.md` → documents accepted axis vocab (languages, domains, strictness levels, backends, layer names) and the 4-stage pipeline matching `GRAMMAR.md`.
- [x] Proof: run the generator for config `{language=python, domain=web, strictness=full, backend=claude, layers=all-off}`, write output to `basis/evals/out-python-web-full-claude.md` → file exists and is non-empty.

### Step 6: Build the eval fixture + run it (output-quality gate)

Create `basis/evals/eval-set.json`: a list of `{config, must_contain[], must_exclude[]}` cases turning "coherent" into grepable assertions. Minimum cases:
- `{python,web,full,claude}` → must_contain: TDD sequence, anti-stub grep line, pre-completion AUDIT block, `pytest`; must_exclude: `cargo`, deepseek tool-scaffolding marker.
- `{rust,cli,lean,claude}` → must_contain: `cargo`; must_exclude: AUDIT block (lean strips ceremony), `pytest`.
- `{python,web,full,deepseek}` → must_contain: deepseek tool-scaffolding block; the `{...,claude}` variant must_exclude it.
- `{python,web,full,claude, layers:{liedetector:on}}` → must_exclude: standalone "no emoji" line.
Add a runner (`basis/evals/run.*` or documented commands) that generates each config and asserts contains/excludes.

- [x] Proof: read `eval-set.json` → ≥4 cases covering language swap, strictness section-strip, backend conditional, and layer toggle.
- [x] Proof: run the eval runner over all cases → every case PASS (all `must_contain` present, all `must_exclude` absent); exit 0 / explicit "ALL PASS".
- [x] Proof: `rtk grep "pytest" basis/evals/out-python-web-full-claude.md` → ≥1 match AND `rtk grep "cargo" basis/evals/out-python-web-full-claude.md` → no matches.
- [x] Proof: generate `{python,web,full,deepseek}` and `{python,web,full,claude}`; the deepseek output contains the tool-scaffolding marker, the claude output does not → confirmed by grep on both files.

### Step 7: Usage doc + sample assemblies

Write `basis/README.md`: how to invoke the generator, the axis vocab, the layer toggles, how to extend (add a language/domain/component). Include ≥2 committed sample outputs in `basis/evals/`.

- [x] Proof: read `basis/README.md` → documents the invocation sentence form, all 5 axes + layer toggles, and an "add a language" + "add a component" extension recipe.
- [x] Proof: `Glob` `basis/evals/out-*.md` → ≥2 sample assembly outputs present, each non-empty.
