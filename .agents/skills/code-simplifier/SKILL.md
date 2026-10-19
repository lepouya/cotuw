---
name: code-simplifier
description: >-
  Simplify recently changed code for clarity and maintainability while
  preserving agreed behavior. Use for a requested cleanup pass; keep broader
  architecture changes within a selected refactoring plan.
license: Apache-2.0
---

# Code Simplifier

Read the [project rules](../../../docs/architecture-review.md#project-rules)
and then [the upstream instructions](UPSTREAM.md). Apply them within the task
scope, with the project rules and adaptations below taking precedence.
Resolve upstream references relative to this skill directory.

This is a Codex adaptation of Anthropic's agent prompt. Apply its clarity,
nesting, naming, and abstraction guidance to the requested changed code. Use
the current model; the upstream `model: opus` field is source metadata, not a
runtime requirement.

Use AGENTS.md and nearby TypeScript conventions in place of CLAUDE.md and the
prompt's React-specific or hard-coded style preferences. Preserve the selected
architecture. Report new structural concerns for separate consideration.

Only edit within the authorized cleanup scope; upstream's proactive wording
does not expand it. Inspect the diff and run the affected behavior checks and
`npm run check` after edits. Report actual commands and results.
