---
name: architectural-refactor
description: >-
  Execute a selected architecture assessment as ordered, verifiable chunks.
  Use for an authorized structural refactor spanning several steps or
  sessions; diagnosis belongs to the review skills.
license: MIT
---

# Architectural Refactor

Read the [project rules](../../../docs/architecture-review.md#project-rules)
and then [the upstream instructions](UPSTREAM.md). Apply them within the task
scope, with the project rules and adaptations below taking precedence.
Resolve upstream references relative to this skill directory.

Apply the upstream chunking, dependency ordering, verification, and resume
process to the selected assessment. A review request authorizes assessment,
not implementation. Existing authorization for a concrete implementation plan
satisfies upstream's sign-off step; do not request it again.

For substantial work, keep the current plan and manifest under
`docs/architecture-review/`. Include findings, chunk status, verification
results, and the next action. Use version control for history instead of an
append-only refactor log. Read this state when resuming.

Run focused tests, lint, and type checks for each chunk; run `npm run check`
before finishing and `npm run check:full` before an authorized commit. Preserve
unrelated edits. Replace upstream's automatic commits and broad restore/stash
steps with task-scoped actions that respect the user's authorization. Revisit a
failed plan with evidence; do not skip verification or silently widen scope.
