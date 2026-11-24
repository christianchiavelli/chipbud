# 0004. Mappings are configuration, not defaults

**Status:** Accepted

## Context

The benchmark says `this.$store`, `this.$router` and `this.$nextTick` are among the most common
things in real Vue 2 code. Converting them is mechanically simple: each becomes a local binding
created during setup.

The problem is what the local binding is called and where it comes from. `$store` is
`useStore()` from `vuex`, or `useStore()` from `pinia`, or a project's own injection. `$router`
is `useRouter()` from `vue-router`, unless the project wraps it. `$nextTick` is `nextTick` from
`vue` and nothing else.

Guessing wrong produces code that compiles and fails at runtime, which is the failure mode this tool
exists to avoid.

## Decision

Three categories, three treatments:

1. **Built in.** `$nextTick` → `nextTick` from `vue`. True for every Vue 3 project, so it needs
   no configuration and produces no diagnostic.
2. **Configured.** Anything else is a mapping in `chipbud.config.json`:

   ```json
   { "globals": { "$store": { "from": "vuex", "as": "store", "call": "useStore" } } }
   ```

   `from` is the module, `as` is the local name, and the optional `call` says the module exports
   a factory to invoke once.
3. **Unmapped.** The property stays a refusal, and it is reported with the reason, not as an
   unknown name.

The Vuex helper spreads (`...mapGetters`, `...mapState`, `...mapActions`, `...mapMutations`)
follow from the same decision: they need a store binding, so they convert only when `$store` is
mapped. When it is not, the spread is reported **once**, and the names it provides are recorded
as `external` so the file does not produce one diagnostic per usage.

## Consequences

- A project that maps nothing still gets `$nextTick` and a clean report; a project that maps
  `$store` gains the spreads for free.
- The tool never emits an import for a library the project might not have.
- The config is one flat object with no nesting and no plugin hooks. If it grows a second
  concept, that is the moment to reconsider it, not before.
- `store-not-mapped` exists because `external` names silence the noise that would otherwise
  explain the refusal. Suppressing a symptom is only acceptable when the cause is still on the
  page.
