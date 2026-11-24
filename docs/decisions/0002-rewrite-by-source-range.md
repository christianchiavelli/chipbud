# 0002. Rewrite by source range instead of regenerating code

**Status:** Accepted

## Context

Two ways to move code from an options object into a new block:

1. Parse, build a fresh AST, print it. Clean model of the output, but every printed token is
   new: formatting, quotes, trailing commas, `async` placement, comments. A 400-line diff
   where 12 lines changed is a review nobody can do.
2. Keep the original text and splice it. The output is the input plus the minimum number of
   characters, so the diff is the change.

The second is harder: offsets have to be right, and edits have to be applied back to front.

## Decision

Every conversion is a list of `{ start, end, text }` edits against the original script block.
Code is moved as source slices, never re-printed.

- `this.x` becomes `x.value` by replacing one member expression's range.
- A method body is emitted by slicing its braces, not by printing its statements.
- The only text `chipbud` writes from scratch is the syntax it introduces: `const`, `ref(...)`,
  `computed(...)`, `defineProps(...)`, and the `<script setup>` tag.

## Consequences

- Diffs stay reviewable, which is the whole point of a migration tool.
- Indentation has to be repaired by hand, because a block lifted out of a nested object keeps
  its original indentation. `formatBlock` in `emit.ts` does that, and nothing else does.
- New syntax cannot be prettified. Running Prettier on the output is the user's call, not the
  tool's: reformatting inside a migration hides the semantic change.
- Comments inside the moved code survive, because the code is never re-printed.
