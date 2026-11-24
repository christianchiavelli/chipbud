# 0001. Convert a file whole or not at all

**Status:** Accepted

## Context

A migration tool that writes a file while unsure about part of it produces the worst artifact
in a migration: code that looks converted, compiles, and behaves differently. The failure
surfaces later, in a review or in production, and by then the tool's output and the human's
edits are mixed.

The alternative, writing what is safe and commenting out the rest, is worse. It leaves `// TODO`
markers that nobody can enumerate six months later.

## Decision

`migrateSource` returns an output only when the file converted with zero review diagnostics.

- At least one review-level diagnostic: `status: 'needs-review'`, `output: null`, file untouched.
- At least one error-level diagnostic: `status: 'error'`, `output: null`.
- Diagnose first, emit second, write third. The report is a complete answer on its own.

## Consequences

- A real legacy component often ends up `needs-review` on the first run. That is the point:
  the report is the deliverable, and the list shrinks as the tool grows coverage.
- The tool works on a per-file basis, so `--write` can be run at any point in a migration
  without a partially converted tree.
- Any future "force" flag has to be a separate command, not a modifier on this one, or the
  invariant stops meaning anything.
