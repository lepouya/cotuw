---
name: reviewing-code-modularity-skill
description: >-
  Review module ownership, coupling, information hiding, and abstractions
  using code evidence. Use for modularity reviews, architectural candidate
  challenges, interface design, or a requested behavior-preserving refactor.
license: MIT
---

# Reviewing Code Modularity

Read the [project rules](../../../docs/architecture-review.md#project-rules)
and then [the upstream instructions](UPSTREAM.md). Apply them within the task
scope, with the project rules and adaptations below taking precedence.
Resolve upstream references relative to this skill directory.

Use upstream mode A to challenge existing findings against code, mode B to
find candidates, mode C to explore a selected interface, and mode D to implement
an authorized refactor. Read only the relevant `references/` files.

During a milestone challenge, compare no change, local repair, and substantial
redesign. Separate impact from evidence; fewer files or a familiar pattern do
not establish improvement. Follow the declared contract changes rather than
preserving an internal API the user explicitly chose to replace.
