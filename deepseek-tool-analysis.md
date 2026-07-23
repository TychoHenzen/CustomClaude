# DeepSeek-on-Claude-Code: Tool, Skill, MCP, and Agent Analysis

> **Date:** 2026-07-23
> **Context:** Most development work is now done via DeepSeek on Claude Code's backend (deepclaude proxy, `127.0.0.1:3200`, `/anthropic` endpoint). Claude Code thinks it's talking to Claude — but it's DeepSeek. This mismatch is the root of most failure modes.

---

## Architecture

```
DeepSeek → deepclaude proxy (127.0.0.1:3200) → Claude Code harness
```

Claude Code harness provides the full tool surface (Bash, Read, Write, Edit, Agent, skills, MCP servers). DeepSeek sees the same tool definitions Claude would — but has different reasoning capability, different context-window behavior, and critically different tool-use discipline.

---

## DeepSeek's Known Failure Modes (Relevant to Tool Use)

1. **Tool call hallucination** — invents tool results without waiting for actual output; skips required calls; calls wrong tool for the job
2. **Multi-step collapse** — jumps to conclusion after step 1 of N; skips verification; treats "run the thing" as "thing succeeded"
3. **Schema confusion** — misuses complex nested tool parameters; omits required fields; invents parameter names
4. **Context window** — smaller effective window than Claude; degrades faster on long sessions; mid-session quality drops hard
5. **Self-correction blindness** — when wrong, rarely self-corrects; doubles down or fabricates confirmation of incorrect approach
6. **Premature "done"** — claims completion after partial work; doesn't verify; skips stated requirements silently

---

## 🔴 ACTIVELY HARMFUL — Remove, Disable, or Never Route to DeepSeek

These tools/skills/agents require model capabilities DeepSeek demonstrably lacks. Using them wastes tokens on wrong output or, worse, produces plausible-looking but incorrect results.

### Skills

| Skill | Failure Mode | Severity |
|-------|-------------|----------|
| **debate / caveman-debate** | Multi-agent coordination with mid-debate check-in. DeepSeek won't run 3-5 expert rounds — collapses to 1-2, skips synthesis, produces fake consensus. The mid-debate check-in becomes meaningless. | High — silent consensus on wrong answer |
| **tdd** | Red-green-refactor cycle requires strict phase discipline. DeepSeek skips red phase, writes implementation before test, fakes test results. The whole point of TDD (test as spec) is lost. | High — untested code presented as TDD-verified |
| **blueprint** | Complex multi-PR planning with adversarial review gate, dependency graph, parallel step detection. DeepSeek's plans look plausible but miss dependencies, skip edge cases, produce unbuildable step sequences. | High — multi-session work built on wrong plan |
| **solve / solve-resume** | Adversarial candidate evaluation assumes model can critique its own candidates. DeepSeek picks first plausible answer, rates it 8/10, moves on. The "adversarial" part is performative. | Medium — picks suboptimal (but not catastrophic) solution |
| **dod-guard:ratchet** | Multi-phase: triage → requirements → DoD → loop with verification gates → gitevo branching → evomcp cascade. DeepSeek short-circuits the loop after 1 iteration, skips verification checks, reports fake passes. | Critical — verification gates are the whole point |
| **dod-guard:quality-upgrade** | 5-phase orchestrator (baseline → fix cycles → coverage gaps → final verify → commit) with subagent-per-file discipline. Each phase silently degrades; manifests report fake scores. | Critical — quality scores become unreliable |
| **dod-guard:clean-house** | Git archaeology to find + delete old implementations. Wrong deletions are catastrophic; DeepSeek can't trace authorship or distinguish "dead code" from "differently-named live code." | Critical — data loss risk |
| **interview / dod-guard:interview** | Requirement elicitation through structured questioning. DeepSeek asks shallow questions, misses contradictions in user answers, produces false confidence "requirements complete" signal. | Medium — bad requirements poison everything downstream |
| **iterative-retrieval** | Progressive context refinement assumes self-awareness of knowledge gaps. DeepSeek doesn't reliably know what it doesn't know — each "iteration" adds noise not signal. | Low — wastes tokens, doesn't help |
| **parallel-agents** | Coordinating 2+ independent agents requires reliable dispatch + correct result synthesis. DeepSeek muddles which result came from which agent, or skips synthesis entirely. | High — lost work, wrong conclusions |
| **algorithm-audit** | Systematic tracing through all branches and edge cases. DeepSeek skips branches, misses off-by-one, doesn't trace through failure paths. | Medium — misses bugs it claims to have checked |
| **postmortem** | Root cause analysis: timeline, 5-Whys, fishbone, action items. DeepSeek stops at first plausible cause, skips systemic factors, produces generic action items. | Medium — wrong lessons learned |
| **research** | Multi-source synthesis with citation. DeepSeek hallucinates sources or conflates multiple sources into one. | Medium — plausible-sounding false research |
| **rules-distill** | Cross-skill pattern recognition to extract rules. DeepSeek produces vague generic rules ("be more careful") instead of specific project patterns. | Low — wastes tokens |
| **eval-harness** | Formal EDD framework with evaluation gates. DeepSeek can't maintain evaluation discipline — passes its own work, misses regressions. | High — false green signals |
| **gan-style-harness** | Generator-evaluator loop. Evaluator (same model) is lenient — can't critique its own generator's work effectively. | High — adversarial dynamic collapses |
| **liedetector** | Confidence calibration (~N%) is model-specific. DeepSeek's calibration curve is different from Claude's — its "90%" means something else. The tags become actively misleading. | Medium — false confidence signals |
| **pair** | Incremental validation at each step. DeepSeek skips validation steps, treats "I wrote it" as "it works." | Medium — broken incrementally |
| **subagent-development** | Multi-agent dispatch with two-stage review. Both review stages degrade; accepted patches are unreviewed. | High — unreviewed code merged |
| **prompt-optimizer** | Analyzes prompts and suggests improvements. DeepSeek's analysis is shallow — misses structural issues, suggests generic improvements. | Low — suboptimal but not harmful |
| **spike** | Exploratory throwaway prototype. DeepSeek "completes" spike without exploring alternatives, then presents the single path as conclusive. Defeats the purpose (exploration). | Low — spike isn't exploratory |

### Agents

| Agent | Failure Mode | Severity |
|-------|-------------|----------|
| **Plan** | Architectural reasoning produces plausible but wrong plans — misses constraints, invents non-existent APIs, glosses over integration points. | Critical — wrong architecture |
| **tdd-decomposer** | Systematic decomposition into atomic test cases. DeepSeek produces coarsely-grained cases that miss edge conditions; the "atomic" property is lost. | High — TDD cycle broken at step 0 |
| **tdd-refactor-reviewer** | Identifies code smells, LLM-isms, magic numbers. DeepSeek misses domain-specific smells, flags non-issues, suggests generic renames. | Medium — clean code gets dirtied |
| **tdd-green-implementation** | Write minimal code to pass test. DeepSeek over-implements ("while I'm here..."), adds scope creep that isn't covered by the test. | Medium — untested scope creep |
| **tdd-red-agent** | Write failing test for specific behavior. DeepSeek writes tests that accidentally pass (weak assertions, wrong mock setup) or test the wrong thing. | Medium — false red |
| **debug-investigator** | Systematic: reproduce → isolate → diagnose → fix. DeepSeek skips reproduction, jumps to diagnosis based on symptom description alone. | High — wrong fix for right symptom |
| **root-cause-analyzer** | 5-Whys, fishbone, timeline reconstruction. DeepSeek stops at first "why," produces shallow causal chain. | Medium — treats symptom as root cause |
| **refactor-analyzer** | Code smell detection, dead code, complexity issues. DeepSeek hallucinates patterns that don't exist in the codebase; misses real issues. | Medium — noise drowns signal |
| **refactor-planner** | 3 concrete refactoring candidates with adversarial self-critique. Self-critique is weak — rates all 3 as good, misses shared failure mode. | Medium — picks wrong refactor |
| **refactor-validator** | Build, test, structural checks for behavior preservation. False positives are the risk — DeepSeek may report "pass" when tests didn't actually run. | High — false green on refactor verification |
| **architecture-mapper** | Layered architecture maps via incremental exploration. Misses connections between modules; produces incomplete dependency graphs. | Medium — misleading architecture picture |
| **code-simplifier** | Simplifies while preserving functionality. DeepSeek changes behavior unintentionally, doesn't run tests after. | Medium — subtle breakage |
| **training-data** | Generate/validate training datasets. Hallucinated training data poisons downstream fine-tuning. | Critical — dataset contamination |
| **general-purpose** | Catch-all. Too open-ended for DeepSeek — no guardrails, full tool access, high variance. | Variable — depends entirely on prompt |

### MCP Tools

| Tool | Failure Mode | Severity |
|------|-------------|----------|
| **sequential-thinking** | DeepSeek doesn't need help structuring thoughts — it needs help NOT cutting corners. This tool adds overhead without fixing the core problem. | Low — just wasteful |
| **dod_check (with complex trees)** | DeepSeek skips proof execution, reports fake passes. Multi-node trees with category-specific predicates are too complex to set up correctly. | Critical — verification becomes theater |
| **dod_create (complex)** | Wrong predicate types, wrong commands, wrong tree structure. The DoD document looks correct but can't actually verify anything. | High — fake verification gates |

---

## 🟢 ACTIVELY USEFUL — Keep, Rely On, Prefer

These work well because they are either:
- **Deterministic** — output depends on tool output, not model reasoning
- **Bounded** — single well-defined task with natural completion signal
- **Read-only** — no mutation, no damage possible
- **Pattern-matching** — surface-level analysis, not deep reasoning

### MCP Servers

| Server | Why Good | Priority |
|--------|---------|----------|
| **context-mode** | **Essential.** DeepSeek's smaller effective context window needs aggressive context management. `ctx_execute`/`ctx_execute_file` = Think-in-Code keeps raw bytes out. `ctx_search` = retrieve indexed content without re-reading. `ctx_batch_execute` = parallel commands with auto-index. Single highest-ROI tool for DeepSeek sessions. | Critical |
| **context7** | Documentation lookup. Simple request→response with no mutation. DeepSeek's training cutoff is older than Claude's — fresh docs matter more. Low misuse surface. | High |
| **obsidian-rag** | Knowledge retrieval (search, read, recall). Simple query→results pattern. Inject project context without burning context window on docs. | High |

### Skills

| Skill | Why Good | Best Use |
|-------|---------|----------|
| **caveman:cavecrew-builder** | Surgical 1-2 file edit. Refuses 3+ file scope (fails safe). Bounded scope = low failure surface. | Routine single-file fixes |
| **caveman:cavecrew-investigator** | Read-only code location. No mutation risk. Structured output format constrains hallucinations. | "Where is X defined?" lookups |
| **caveman:cavecrew-reviewer** | Structured diff review with per-line format. Harder to hallucinate when output format is rigid. | Small diff reviews |
| **caveman:caveman / caveman-commit / caveman-compress** | Token compression at every level. Directly reduces DeepSeek's context pressure. caveman-commit produces Conventional Commits with ≤50 char subject. | Always (caveman mode = default) |
| **commit** | Structured commit message generation. Bounded task with clear output. Conventional Commits format constrains output shape. | Post-change commits |
| **verify-before-claiming** | Forces verification habit. Mitigates DeepSeek's #1 meta-problem: claiming done without checking. This skill should be mandatory after every DeepSeek implementation. | After every code change |
| **code-review (low/medium)** | Bounded review with specific patterns at lower effort levels. Don't use high/max — false positive rate climbs. | Pre-commit review |
| **simplify** | Quality-only cleanup (no bug hunting). Lower risk than code-review since it's not making correctness claims. | Post-implementation cleanup |
| **security-audit** | Pattern-matching based on OWASP Top 10 rulesets. Deterministic — runs grep-like patterns, not model reasoning. | Pre-commit security gate |
| **tech-debt-score** | Deterministic static analysis. Maintains TECH_DEBT_LEDGER.md with computed scores. No model reasoning in the scoring — just runs tools and tallies. | Periodic codebase health check |
| **review-pr-branch** | Structured review checklist. The checklist format constrains output — harder to skip items. | PR review |
| **pre-pr-review** | Ticket-completion + code-quality checklist. Checklist structure provides natural verification that all items were checked. | Pre-PR self-review |
| **clean_gone** | Simple git branch cleanup: detect [gone] branches, remove worktrees. Deterministic operation. | Branch housekeeping |
| **context-mode skills** (ctx-doctor, ctx-stats, ctx-upgrade, ctx-purge) | Simple diagnostics. Run a command, display output. No reasoning required. | Context-mode maintenance |
| **update-config** | Simple config file changes. Bounded: "add this permission," "set this env var." | Config changes |
| **keybindings-help** | Reference lookup. Read-only. | Keybinding questions |
| **claude-api** | Reference lookup for Claude API docs. Read-only, bounded. | API questions |
| **memory-types** | Reference lookup for memory taxonomy. Read-only. | Memory writing questions |
| **fewer-permission-prompts** | Scans transcripts for tool call patterns, generates allowlist. Pattern-matching, not reasoning. | Permission prompt reduction |
| **init** | Codebase documentation generation. Reads files, writes CLAUDE.md. Mostly deterministic — pattern extraction from existing code. | New project setup |
| **run** | Launch project app. Bounded: find launch method, execute it, observe output. | Driving app to verify changes |
| **loop** | Simple recurring task scheduler. Runs a command on interval. No reasoning involved — just cron + re-invoke. | Polling deploys, recurring checks |

### Agents

| Agent | Why Good | Best Use |
|-------|---------|----------|
| **caveman:cavecrew-builder** | Bounded 1-2 file edits. Refuses scope creep (fails safe). | Routine fixes |
| **caveman:cavecrew-investigator** | Read-only code location. No damage possible. Structured output. | Code lookups |
| **caveman:cavecrew-reviewer** | Structured review output format constrains hallucination. | Small diff reviews |
| **Explore** | Read-only search agent. Low risk since no mutations possible. | Broad codebase searches |
| **build-error-resolver** | Single goal: fix build error, get to green. Bounded scope, natural completion signal (build passes). | Build/type error fixes |
| **security-scanner** | Pattern-based OWASP scanning. Deterministic rules, not reasoning-dependent. | Security audits |
| **dod-guard:step-implementer** | ONE atomic step. Hard-refuses to go beyond. This constraint is exactly what DeepSeek needs — it can handle one step, it can't handle orchestrating many. | Single atomic implementation step |
| **dod-guard:step-fixer** | Targeted repair against a reported error. Bounded: fix THIS error, nothing else. | Fixing specific test/build failure |
| **evomcp:spec-writer** | Write spec + run ambiguity check. Pre-fanout gate — highest leverage in cascade. Output is a document, not code, so less damage from errors. | Writing cascade specs |
| **evomcp:patch-reviewer** | Review cascade solve output. Structured review of a single diff. Bounded. | Reviewing cascade patches |
| **statusline-setup** | Simple config edit for status line. Bounded. | Status line configuration |
| **claude-code-guide** | Reference lookup for Claude Code docs. Read-only. | Claude Code usage questions |

---

## 🟡 MIXED — Use With Strict Guardrails

These can work but need explicit constraints, external verification, or Claude-as-orchestrator.

| Tool/Skill | Risk | Mitigation | Who Orchestrates |
|------------|------|------------|-----------------|
| **dod-guard:step-by-step** | Multi-step dispatch. DeepSeek will batch steps, skip verification. | Claude MUST be orchestrator. DeepSeek only runs individual step-implementer/step-fixer agents. Never let DeepSeek drive the orchestrator loop. | Claude only |
| **evomcp:cascade** | Designed for DeepSeek fanout, but spec-writing, review gates, and escalation handler need model strong enough to critique. | Spec-writer and patch-reviewer agents on DeepSeek (they're bounded). Escalation handler on Claude. Claude reviews final patches before merge. | Mixed: DeepSeek for fanout, Claude for gates |
| **evomcp:escalation-handler** | Triage stuck nodes: authority vs capability classification. Requires diagnostic reasoning DeepSeek may get wrong. | Run on Claude if the classification determines next action. DeepSeek can run it for simple "command failed" triage. | Prefer Claude |
| **refactor** | Self-checking assumes model catches its own errors during refactor. DeepSeek won't. | Run refactor-validator agent externally. Never trust DeepSeek's self-check on its own refactors. | Either, but verify externally |
| **debug** | Will skip reproduction, jump to fix. | Force reproduction step: require a written test or repro command output before any fix code. | Either with constraints |
| **dataviz** | Chart creation is bounded and visual output is self-evidently right/wrong. | OK for simple charts. Review complex dashboards. The visual nature provides natural verification. | DeepSeek OK |
| **learn** | Transcript mining to distill instincts. May draw wrong patterns from ambiguous sessions. | Always review output before committing to INSTINCTS.md. The confidence scores it assigns are DeepSeek's, not calibrated. | Either, review output |
| **create_note (obsidian-rag)** | Write to Obsidian vault. Mutation, but bounded (one note). | OK — single note creation is low risk. Don't chain multiple create_note calls in one reasoning step. | DeepSeek OK |

---

## ➕ WHAT'S MISSING — Recommended Additions

### 1. Tool-Call Validator Hook (Priority: CRITICAL)

DeepSeek's #1 failure mode: hallucinating tool results — reporting output from a command it never ran, or fabricating read results.

**Design:**
- PostToolUse hook that compares tool result to known hallucination patterns
- Checks: empty-but-claimed-success, repeated identical output across different calls, impossible values (e.g., file content that can't exist on this filesystem)
- On detection: re-prompt DeepSeek with "That result was fabricated. Call the tool again and use the actual output."

**Implementation:** CustomClaude.cmd hook, likely as a PreToolUse/PostToolUse pair in settings.json.

### 2. Task Complexity Router (Priority: HIGH)

Routes tasks to appropriate model UPFRONT instead of escalating after failure. Inverse of current cascade pattern.

**Design:**
- PreToolUse hook that classifies the user request by complexity
- Simple classifier (regex + pattern match, not model-based):
  - **→ DeepSeek:** single-file edits, typo fixes, simple lookups, doc queries, lint fixes, config changes, commit messages
  - **→ Claude:** architectural changes, multi-file refactors, complex debugging, >3 tool calls expected, any task touching >2 files
- Could be implemented as a PreToolUse hook that sets a model preference or as a routing layer in CustomClaude.ps1

### 3. Automatic Retry-With-Rephrase (Priority: HIGH)

When a tool call fails or returns unexpected output, DeepSeek often repeats the identical broken call — it doesn't adapt its approach.

**Design:**
- PostToolUse hook that detects: identical command retry after failure, same tool+params after error, same read path returning unchanged content
- Rephrases the prompt: "That command failed with [error]. Try a DIFFERENT approach — do not repeat the same command."
- Caps retries at 2 before escalating to Claude
- Tracks retry count per tool-call chain

### 4. DeepSeek Context Budget Monitor (Priority: MEDIUM)

DeepSeek's effective context window is smaller than Claude's advertised 200K. Mid-session quality drops hard when context fills up.

**Design:**
- Monitors estimated token usage in current session
- Warns at ~60% of DeepSeek's practical limit (need to determine exact threshold empirically)
- Auto-suggests compaction strategies: summarize conversation, drop old tool results, restart session
- Could integrate with context-mode ctx_stats to get real numbers

### 5. Verification Loop Skill — Simplified dod-guard (Priority: MEDIUM)

Current dod-guard is too complex for DeepSeek to set up correctly (tree structures, category-specific predicates, draft nodes). But DeepSeek NEEDS verification — more than Claude does.

**Design:**
- Strip dod-guard to bare minimum: `run command → check exit code → report pass/fail`
- No tree structure, no draft nodes, no categories, no baselines
- Single purpose: "Does X pass?" for self-verification after changes
- Commands are written by Claude (or user), DeepSeek just runs and reports honestly
- Could be a skill or a simple MCP tool

### 6. DeepSeek Failure Pattern Detector (Priority: LOW-MEDIUM)

Parse session transcripts to detect recurring DeepSeek-specific failure patterns and inject preventive prompts.

**Design:**
- Analyze session transcripts for: skipped verification, hallucinated tool output, premature "done" claims, repeated identical errors
- Feed patterns back as prompt prefix: "In previous sessions, you skipped step 3 — do not skip step 3"
- Requires a corpus of DeepSeek sessions to mine patterns from
- The `/learn` skill could be adapted for this but needs DeepSeek-specific pattern definitions

### 7. Model-Aware Skill Dispatch (Priority: LOW)

Modify skill triggering to be model-aware — some skills auto-degrade or refuse to run under DeepSeek.

**Design:**
- Skills declare `minimum_model: claude-haiku | claude-sonnet | claude-opus | any`
- Skills in the "harmful" list set `minimum_model: claude-sonnet`
- When DeepSeek invokes a skill below its minimum, the skill responds: "This skill requires Claude [model]. Re-invoke with Claude or use [alternative]."
- Trivially implementable in skill markdown frontmatter

---

## 🔧 Modifications to Existing Tools

| Current | Change | Reason |
|---------|--------|--------|
| **dod-guard MCP** | Add `--model deepseek` flag that: simplifies predicates to exit_code only, disables multi-node trees, disables draft→concrete workflow, runs in single-shot verify mode | DeepSeek can't set up or maintain complex DoD trees. Give it a flat list of commands to run. |
| **debate skill** | Add `--single-expert` mode: structured pros/cons analysis without multi-agent coordination | Multi-agent is wasted on DeepSeek. Structured analysis is still useful. |
| **All skills with adversarial review** | Gate behind model check: skip adversarial phase if model != Claude; run single-pass analysis instead | DeepSeek's self-critique is too weak to be adversarial. Don't pretend it works. |
| **Agent tool** | Add `model_override` parameter to route specific subagents to Claude even when main session model is DeepSeek | Critical agents (Plan, debug-investigator, root-cause-analyzer) always get Claude. |
| **verify-before-claiming skill** | Make it a post-ToolUse hook instead of opt-in skill: auto-inject "before claiming done, run [verification command]" after any Write/Edit | DeepSeek won't opt into verification. Make it automatic. |
| **caveman:cavecrew-builder** | Already good. Consider lowering max file count to 1 (from 2) for DeepSeek sessions. | Single-file constraint is safer. |

---

## Operating Principles for DeepSeek Sessions

1. **Verification is mandatory, not optional.** Never trust "done" without tool output proving it.
2. **Bounded tasks only.** If the task can't be described in one sentence with one acceptance criterion, it's too big for DeepSeek.
3. **External verification beats self-verification.** Run tests, linters, type-checkers — don't ask DeepSeek "does this look right?"
4. **One change per turn.** Don't let DeepSeek chain multiple edits in one reasoning block. Each Write/Edit should be followed by verification before the next.
5. **Context is expensive.** Use context-mode aggressively. Index docs. Think-in-Code. DeepSeek's window is tighter than Claude's.
6. **Fail fast, escalate.** If DeepSeek's first attempt fails, don't let it retry the same approach. Either rephrase the prompt or escalate to Claude.
7. **Simpler tools work better.** Prefer exit_code predicates over output_contains. Prefer flat commands over nested trees. Prefer single-file edits over multi-file refactors.

---

## Quick Reference Card

```
KEEP (DeepSeek-friendly):
  MCP:    context-mode, context7, obsidian-rag
  Skills: cavecrew-*, commit, verify-before-claiming, code-review(low/med),
          simplify, security-audit, tech-debt-score, clean_gone, spike,
          context-mode:*, update-config, claude-api, memory-types, loop
  Agents: cavecrew-*, Explore, build-error-resolver, security-scanner,
          dod-guard:step-implementer, dod-guard:step-fixer,
          evomcp:spec-writer, evomcp:patch-reviewer

AVOID (needs Claude-level reasoning):
  Skills: debate, tdd, blueprint, solve, dod-guard:ratchet,
          dod-guard:quality-upgrade, dod-guard:clean-house, interview,
          parallel-agents, algorithm-audit, postmortem, research,
          rules-distill, eval-harness, gan-style-harness, liedetector,
          pair, subagent-development
  Agents: Plan, tdd-*, debug-investigator, root-cause-analyzer,
          refactor-analyzer, refactor-planner, architecture-mapper,
          code-simplifier, training-data

MIXED (use with guardrails):
  Skills: dod-guard:step-by-step (Claude orchestrator only),
          evomcp:cascade (Claude on gates), refactor (verify externally),
          debug (force reproduction first), learn (review output)
  Agents: evomcp:escalation-handler (prefer Claude for classification)
```
