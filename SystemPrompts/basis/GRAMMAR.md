# Assembly Grammar

Two tuning mechanisms. A component with no directives is valid plain markdown.

## 1. Placeholder swap (`<TOKEN>`) — Language axis only

Six tokens, resolved from `values/languages.yaml` for the chosen language:

| Token | Source key | python example |
|-------|-----------|----------------|
| `<LANG_TEST_CMD>` | `test_cmd` | `pytest` |
| `<LANG_BUILD_CMD>` | `build_cmd` | `python -m py_compile .` |
| `<LANG_LINT_CMD>` | `lint_cmd` | `ruff check .` |
| `<LANG_STUB_KEYWORDS>` | `stub_keywords` | `pass, raise NotImplementedError, ...` |
| `<LANG_FN_LINE_LIMIT>` | `fn_line_limit` | `50` |
| `<LANG_FILE_LINE_LIMIT>` | `file_line_limit` | `800` |

A token left unresolved (no matching key) is an error.

## 2. Conditional blocks (`@when`) — Domain, Strictness, Backend, Layers

HTML-comment directives so the raw component stays readable markdown:

```
<!-- @when EXPR -->
...content included only when EXPR is true...
<!-- @end -->
```

`@when` blocks may not nest. Every `@when` needs a matching `@end`.

### Expression forms

| Form | Operators | Meaning | Examples |
|------|-----------|---------|----------|
| strictness | `>=`, `=` | compares on order `lean < full < paranoid` | `@when strictness>=full`, `@when strictness=paranoid` |
| backend | `=` | exact match | `@when backend=deepseek`, `@when backend=claude` |
| domain | `=` | exact match | `@when domain=web`, `@when domain=ml` |
| layers | `=on` / `=off` | layer toggle state | `@when layers.liedetector=off`, `@when layers.rtk=on` |

Only one condition per `@when` (no boolean combinators). Express AND by nesting sections at manifest level or repeating gating in adjacent blocks.

## Section-level inclusion — manifest fields

`manifest.yaml` lists each component with `min-strictness`, `domains`, `backends`. A whole component is **dropped** before block processing when:

- config strictness `<` component `min-strictness`, OR
- component `domains` is a list not containing config domain (and not `all`), OR
- component `backends` is a list not containing config backend (and not `all`).

The frontmatter `layers` field is **metadata only** (records which layers touch the component); layers never drop a whole component — they operate at block level via `@when`.

## Resolution pipeline (strict order)

1. **Manifest filter** — drop components failing `min-strictness` / `domains` / `backends`.
2. **`@when` filter** — within surviving components, strip blocks whose expression is false; keep block body (minus the comment markers) when true.
3. **Placeholder swap** — replace every `<LANG_*>` token from `languages.yaml`.
4. **Concatenate** — join surviving components in manifest assembly order, separated by blank lines.

Unknown axis values (language/domain/strictness/backend/layer name) are rejected with an error before stage 1.
