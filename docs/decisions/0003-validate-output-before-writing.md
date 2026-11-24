# 0003. Validate the output before writing it

**Status:** Accepted

## Context

A codemod that emits invalid syntax fails at the worst moment. The user runs `--write` on 40
files, the tool reports success, and the build breaks on file 3 with a parse error that has
nothing to do with the migration.

String assembly with offsets is exactly the kind of code that produces a broken file once in
a thousand runs, and 40 files is enough to hit it.

## Decision

Before returning a converted file, `chipbud` checks its own output three times:

1. The generated script block parses with `@babel/parser`, using the same plugins as the input.
2. The whole rewritten `.vue` file parses with `@vue/compiler-sfc`.
3. The script block compiles with `compileScript`, so the macros it emitted are in a shape Vue
   actually accepts, not merely valid JavaScript.

If any of them fails, the result is `status: 'error'` with code `output-invalid`, and nothing is
written. The diagnostic says it is a bug in `chipbud`, not in the user's file.

## Consequences

- The failure mode is "the tool refused", never "the tool broke my file".
- Macros are the part of `<script setup>` with no equivalent in plain JavaScript, so they are
  the part that needs the compiler's opinion, not the parser's.
- It costs one extra parse and one compile per converted file. At component granularity that
  is noise.
- The test suite only needs golden files; the compiler is the second opinion that catches the
  cases the fixtures do not cover. It caught a whole class of them: data keys that collided
  with module-level bindings produced code the parser rejected, which is now a
  `name-collision` diagnostic instead of a broken file.
