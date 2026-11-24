# chipbud

Converts one Vue options object into `<script setup>`, or explains exactly why it will not.

Chip budding slips a new bud under the old bark without felling the tree. The old plant keeps
feeding the new growth until it can stand on its own. A migration works the same way, which is
where the name comes from.

`chipbud` is a codemod for the part of a Vue 2 to Vue 3 migration that is mechanical, and a
report for the part that is not. It never guesses. A component is either rewritten as a
whole or not touched at all.

- Package and command: `chipbud`, Node 20+
- Output target: Vue 3.3+, because a preserved `name` becomes `defineOptions`
- Status: `0.1.0`, not on npm yet, run it from a clone
- Dependencies: `@vue/compiler-sfc` and `@babel/parser`. One optional mapping file, no plugin system.

## Before and after

```vue
<script>
export default {
  data() {
    return { count: 0 }
  },
  computed: {
    label() {
      return `Clicked ${this.count} times`
    },
  },
  methods: {
    increment() {
      this.count += 1
    },
  },
}
</script>
```

becomes

```vue
<script setup>
import { computed, ref } from 'vue'

const count = ref(0)
const label = computed(() => `Clicked ${count.value} times`)
function increment() {
  count.value += 1
}
</script>
```

When it cannot prove the conversion, it writes nothing and says why:

```
| file            | status       | converted        | issues |
| src/Picker.vue  | needs-review | data.open        | 2      |

### src/Picker.vue
- `this-instance-property` 12:7 - `this.$refs` has no automatic `<script setup>` equivalent.
- `option-not-supported` 4:3 - `mixins` has no mechanical `<script setup>` equivalent.
```

## Why another codemod

`vue-codemod` covers the API renames (`Vue.prototype`, filter removal, `new Vue`). What it
does not do is move an options object into setup code, because that requires deciding what
to do with `this`, and every wrong decision there is a silent production bug.

`chipbud` makes that decision explicit. It converts what it can prove, and for everything else
it reports a code, a line, and the reason, so the remaining work is a list instead of an
investigation.

## What it converts

| Options API | Becomes |
| --- | --- |
| `data` | `const x = ref(value)` |
| `computed` (function form) | `const x = computed(() => ...)` |
| `methods` | `function x() {}`, or `const x = ...` when the method was an arrow |
| `props` | `defineProps(...)`, same argument text |
| `emits` | `defineEmits(...)`, same argument text |
| `watch` (function form) | `watch(source, handler)` |
| `mounted`, `beforeMount`, `beforeUpdate`, `updated`, `activated`, `deactivated`, `beforeDestroy`, `destroyed`, `errorCaptured` | `onMounted(() => ...)` and friends, `async` included |
| `created` | top-level setup code |
| `name` | `defineOptions({ name })` (needs Vue 3.3+) |
| `components` | dropped when every entry is a local import, which `<script setup>` resolves by itself |
| `this.x` | `x.value` for data, `x` for computed and methods, `props.x` for props |
| `this.$emit(...)` | `emit(...)`, with an untyped `defineEmits()` when the component declared none |
| `this.$nextTick(...)` | `nextTick(...)`, built in |
| `...mapGetters`, `...mapState` | `const x = computed(() => store.getters.y)`, when `$store` is mapped |
| `...mapActions`, `...mapMutations` | `const x = (...args) => store.dispatch('y', ...args)`, when `$store` is mapped |
| `this.$store`, `this.$router`, `this.$route` | the local name the mapping declares |

The template, the styles and any custom block are untouched, byte for byte.

## What it refuses

Every refusal carries a line, a column and a reason. `chipbud` does not write a file it is not
sure about.

| Code | When |
| --- | --- |
| `this-instance-property` | a `$property` with no mapping: `$refs`, `$slots`, `$options` |
| `this-unresolved` | `this.x` where `x` is not data, a computed, a method or a prop |
| `this-shadowed` | a local binding in the same function reuses the name, so `this.x` cannot be rewritten safely |
| `this-nested-function` | `this` inside a plain `function`; Vue 2 did not bind it either, and only arrows keep it |
| `this-assigned` | writing to a computed or a prop |
| `option-not-supported` | `mixins`, `extends`, `filters`, `provide`/`inject`, `render`, `beforeCreate`, an `async` `computed` or an `async` `created` |
| `computed-setter` | `computed: { x: { get, set } }` |
| `watch-options` | `watch: { x: { handler, deep, immediate } }`, and nested paths |
| `component-not-imported` | `components: { Foo }` where `Foo` is not imported |
| `spread-option` | a spread that is not a Vuex helper, such as `...mapState` from another library |
| `store-not-mapped` | `...mapGetters()` and friends with no `$store` in the mapping file; reported once, with the names it provides |
| `store-mapping` | a Vuex helper whose argument is not an array or a string-valued object |
| `data-shape` | `data` that does not return a single object literal |
| `duplicate-binding` | the same name declared in two options |
| `name-collision` | the name is already a top-level binding in the file, or collides with a `vue` import |
| `invalid-binding-name` | a `data`, `computed` or `methods` key that is not a valid identifier |
| `arguments-used` | `arguments` inside a computed, which becomes an arrow function |
| `sfc-not-convertible` | the script is fine but the file is not something Vue 3 accepts, such as `<template functional>` |
| `output-invalid` | the generated code does not parse or compile (a bug in `chipbud`, never shipped silently) |
| `read-error` | the file could not be read |

## Where this fits in a migration

Converting a component is one step of a Vue 2 to Vue 3 migration, and not the biggest one. The
rest is project wiring, and `chipbud` deliberately does not touch it: a codemod that rewrites
your build config badly does not produce a diff you can review, it produces an outage.

| Layer | What changes | `chipbud` |
| --- | --- | --- |
| Dependencies | `vue@3`, `vue-router@4`, `vuex@4` or Pinia, `@vue/test-utils@2`, no more `vue-template-compiler` | no |
| Entry point | `new Vue()` → `createApp()`, `Vue.use` → `app.use`, `Vue.prototype.$x` → `app.config.globalProperties.$x` | no |
| Router | `new VueRouter` → `createRouter`, `mode` → `history: createWebHistory()`, `*` → `/:pathMatch(.*)*` | no |
| Store | `new Vuex.Store` → `createStore` | only `$store` and the helper spreads, through a mapping |
| Component script | `data`, `computed`, `methods`, `props`, `emits`, `watch`, lifecycle hooks | **yes** |
| Component template | `value`/`input` → `modelValue`/`update:modelValue`, `.sync` → `v-model:prop`, `$listeners` → `$attrs`, filters, `transition-group`, `::v-deep` | no |
| Build and tests | vue-cli to Vite, jest to Vitest, karma, sass `~` imports | no |

What remains after `chipbud` runs:

1. **Dependencies**: bump Vue and its ecosystem. The `package.json` is yours to change.
2. **Entry point**: `createApp`, `app.use`, `globalProperties`, and an event bus that is no
   longer `$on`/`$off` on the app instance.
3. **Router and store**: factory functions; `router.push` now returns a rejected promise
   instead of failing silently.
4. **Templates**: component `v-model`, `.sync`, `$listeners`, filters, transition classes,
   `::v-deep`. `chipbud` leaves every template byte for byte, so this is manual by construction.
5. **Build and tests**: the toolchain is the project's own, and it varies too much to guess.
6. **The components it refused**: the report lists them, each with a code and a line.

The numbers below describe components, not migrations. Converting 92 files is not 27% of a
migration; it is 27% of the component files, and every layer above is still waiting.

## Does the conversion change behaviour?

A conversion is only correct if the component keeps working, so that is tested directly.
`test/equivalence.test.ts` mounts each fixture twice, first as written and then after
conversion, and compares the rendered markup and the emitted events, before and after
interacting with it.

Options API is still valid in Vue 3, so the "before" side is a genuine baseline: the same
component, in the same runtime, with nothing of chipbud in between. The suite also contains a
deliberate mismatch, so a comparison that silently stopped comparing would fail.

What this does not prove is that a Vue 2 app behaves like a Vue 3 app. That is the migration's
problem, not the codemod's. chipbud only promises not to change the component it rewrites.

## Usage

Not on npm yet. From a clone:

```bash
git clone https://github.com/christianchiavelli/chipbud
cd chipbud && npm install && npm run build

node dist/cli.js <path>            # report only, writes nothing
node dist/cli.js <path> --write    # rewrite the files that convert cleanly
node dist/cli.js <path> --json     # machine-readable report
```

Once published, the same commands are `npx chipbud <path>`.

Exit codes: `0` everything converted or skipped, `1` at least one file needs review or
failed, `2` usage error. That makes `chipbud src --write` usable as a CI gate.

There is no `--check` mode, because the default already writes nothing.

## Mapping `$`-properties

`$nextTick` is mapped out of the box, because every Vue 3 project has it. Everything else is a
decision about your project, so it lives in `chipbud.config.json` next to `package.json`:

```json
{
  "globals": {
    "$store": { "from": "vuex", "as": "store", "call": "useStore" },
    "$router": { "from": "vue-router", "as": "router", "call": "useRouter" },
    "$route": { "from": "vue-router", "as": "route", "call": "useRoute" }
  }
}
```

`call` means the module exports a factory that runs once during setup; without it the name is
imported and used directly. `--config other.json` points at a different file.

With `$store` mapped, the Vuex spreads are converted too: the same mapping that turns
`this.$store.commit(...)` into `store.commit(...)` is what gives `...mapGetters()` a `store` to
read from. `bench/vuex.config.json` is the file used for the second table below.

## The report

```json
{
  "tool": "chipbud",
  "formatVersion": 1,
  "summary": { "checked": 3, "converted": 0, "needsReview": 3, "skipped": 0, "errors": 0 },
  "files": [
    {
      "path": "src/login.vue",
      "status": "needs-review",
      "converted": ["data.loginForm", "method.handleLogin", "lifecycle.onMounted"],
      "dropped": ["component.Child"],
      "diagnostics": [
        {
          "code": "this-instance-property",
          "message": "`this.$refs` has no automatic `<script setup>` equivalent.",
          "detail": "$refs",
          "line": 132,
          "column": 7
        }
      ]
    }
  ]
}
```

`formatVersion` is the contract. It changes only when a consumer would have to change too.

## Evidence

Measured on three public Vue 2 codebases: shallow clones, unmodified, no `--write`. Default
run, no mapping file:

| corpus | kind | files | converted | needs review | skipped | tool errors | declarations |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `vue-element-admin` | application | 131 | 36 | 88 | 7 | 0 | 749 |
| `vue2-elm` | application | 55 | 11 | 44 | 0 | 0 | 494 |
| `element` | component library | 155 | 18 | 137 | 0 | 0 | 2270 |
| **total** | | **341** | **65** | **269** | **7** | **0** | **3513** |

The same run with `bench/vuex.config.json` (`$store`, `$router`, `$route` mapped):

| corpus | kind | files | converted | needs review | skipped | tool errors | declarations |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `vue-element-admin` | application | 131 | 45 | 79 | 7 | 0 | 764 |
| `vue2-elm` | application | 55 | 28 | 27 | 0 | 0 | 595 |
| `element` | component library | 155 | 19 | 136 | 0 | 0 | 2270 |
| **total** | | **341** | **92** | **242** | **7** | **0** | **3629** |

One mapping file moves 27 more files across the line, and `vue2-elm` goes from 20% to 51% of
its components. The refusals in the default run, aggregated over all 341 files:

| diagnostic | count |
| --- | --- |
| `this-unresolved` | 711 |
| `this-instance-property` | 710 |
| `this-shadowed` | 228 |
| `option-not-supported` | 220 |
| `store-not-mapped` | 62 |
| `watch-options` | 50 |
| `name-collision` | 47 |
| `computed-setter` | 23 |
| `this-nested-function` | 10 |
| other (6 codes) | 27 |

### What the refusals are made of

Reading the member names rather than the counts, the 1,421 `this` diagnostics are three
different problems wearing one label:

- **Members provided by a mixin.** 52 components in `element` mix in shared behaviour, so
  `this.type`, `this.elForm` and `this.broadcast` are declared in a file this component does not
  contain. Nothing here can be converted, and saying so once is enough.
- **State attached to the instance at runtime.** `this._timer = setTimeout(...)` in
  `element/main.vue`: never declared, so there is no binding to move.
- **Helpers reached through a spread.** `...mapGetters()` and `...mapState()` used to produce one
  diagnostic per usage; now the spread is one `store-not-mapped` line naming the members it
  brings, or it converts when `$store` is mapped. This is why `store-not-mapped` is 62 instead of
  the 200-odd symptoms it used to scatter.

That is why the report groups diagnostics by code and lists five per file: the cause is one
line, the symptoms are the rest.

### Why the numbers are trustworthy

`npm run bench` clones each repository at the SHA pinned in `bench/corpora.json`, runs every
component through the public API, and compares the totals with a recorded baseline. The default
run checks `bench/baseline.json`; `npm run bench -- --config bench/vuex.config.json` checks
`bench/baseline.config.json`. If a change moves a number, the command fails with the difference,
so these tables cannot quietly become a lie.

The number that matters is the `tool errors` column: on 341 real files, `chipbud` either
converted or explained. It never produced a file it could not stand behind. A run that emits
`output-invalid` is a bug in the tool, and the tool refuses rather than shipping it. The store
spread conversion was caught this way while it was being written.

Two things are still unproven, and the README should not pretend otherwise: `$refs` is the
largest refusal left, and the behaviour suite runs on fixtures, not on a migrated application
with its own test suite. The next measurement that would matter is converting a real project
and running that project's tests.

## Design notes

- [0001. Convert a file whole or not at all](docs/decisions/0001-convert-a-file-whole-or-not-at-all.md)
- [0002. Rewrite by source range instead of regenerating code](docs/decisions/0002-rewrite-by-source-range.md)
- [0003. Validate the output before writing it](docs/decisions/0003-validate-output-before-writing.md)
- [0004. Mappings are configuration, not defaults](docs/decisions/0004-mappings-are-configuration.md)

## Development

```bash
npm install
npm run verify   # typecheck + tests
npm run build
npm run bench    # every corpus, compared with the recorded baseline
npm run bench -- --config bench/vuex.config.json   # the mapped run
```

`npm run bench -- --update` records a new baseline (one per configuration), and
`npm run bench -- --markdown` prints the table above.

Forty-eight tests in three suites: the conversion and refusal rules as golden files in
`test/fixtures` (input and exact expected output, so a regression is a diff); the behaviour of
each converted component, mounted next to the original in Vue 3 and compared; and the CLI,
spawned as a child process to assert exit codes and that `--write` is the only thing that
touches a file.

The tool ships with two runtime dependencies. The test suite adds Vue 3, `@vue/test-utils` and
`jsdom` as dev dependencies, because the only way to prove behaviour is to run it.

## License

MIT
