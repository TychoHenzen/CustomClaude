# Tunable Dev System-Prompt Basis

Modular component library + deterministic generator that assembles Claude-Code
development system prompts on demand, tuned across five axes.

## Layout

```
basis/
  components/        16 backbone sections, one .md each (frontmatter + body)
  values/languages.yaml   <LANG_*> token table (python/rust/typescript/go)
  manifest.yaml      assembly order + section-level filter rules
  GRAMMAR.md         directive + placeholder grammar, pipeline order
  evals/             eval-set.json, run.py, committed sample outputs
generator engine:  ../../skills/sysprompt-gen/generate.py
generator skill:   ../../skills/sysprompt-gen/SKILL.md  (AskUserQuestion front-end)
```

## Invocation

Conversational (recommended): state the goal, such as *"create a system prompt
for python web development, full strictness, DeepSeek backend"*. The
`sysprompt-gen` skill interviews for any missing axis via AskUserQuestion, then
runs the engine.

Direct:

```
python ../../skills/sysprompt-gen/generate.py \
  --language python --domain web --strictness full --backend claude \
  --layers rtk:off,context-mode:off \
  --out evals/out-python-web-full-claude.md
```

## Axes

| Axis | Values | Mechanism |
|------|--------|-----------|
| **language** | python, rust, typescript, go | placeholder swap (`<LANG_*>`) |
| **domain** | web, ml, cli, data, embedded, generic, game | section filter + `@when domain=` |
| **strictness** | lean < full < paranoid | section filter (`min-strictness`) + `@when strictness>=/=` |
| **backend** | claude, deepseek, other | `@when backend=` (deepseek adds tool-call scaffolding) |
| **layers** | rtk, context-mode | `@when layers.<name>=on/off` (default all off) |

### Layer toggles

A layer that is **on** means that always-on system already enforces something,
so the prompt strips its own redundant copy:

- `rtk` on -> adds `rtk`-prefix command guidance instead of raw commands.
- `context-mode` on -> drops the "preserve tool results" guidance.

Default config = all layers off -> standalone, portable prompt.

## Extending

**Add a language:** append a block to `values/languages.yaml` with all six keys
(`test_cmd`, `build_cmd`, `lint_cmd`, `stub_keywords`, `fn_line_limit`,
`file_line_limit`). No code change is needed, because the engine reads the
table. Then pass
`--language <new>`.

**Add a domain:** add the value to `DOMAINS` in `generate.py`, then gate content
with `<!-- @when domain=<new> -->` blocks or set component `domains` lists in
`manifest.yaml`.

**Add a component:** create `components/<id>.md` with the 7-key frontmatter
(`id`, `purpose`, `when-to-include`, `min-strictness`, `domains`, `backends`,
`layers`), add an entry in `manifest.yaml` `assembly_order` at the desired
position with its `min-strictness`/`domains`/`backends`. Use `<!-- @when ... -->`
blocks and `<LANG_*>` tokens as needed (see `GRAMMAR.md`).

## Verifying

```
python evals/run.py     # generates every eval config, asserts contains/excludes; prints ALL PASS
```

Committed sample outputs live in `evals/out-*.md`.
