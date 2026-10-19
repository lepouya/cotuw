---
name: improve-codebase-architecture
description: >-
  Survey a codebase for architectural friction and deepening opportunities,
  present candidates visually, and explore a selected redesign. Use for a
  requested architecture survey or milestone review.
license: MIT
---

# Improve Codebase Architecture

Read the [project rules](../../../docs/architecture-review.md#project-rules)
and then [the upstream instructions](UPSTREAM.md). Apply them within the task
scope, with the project rules and adaptations below taking precedence.
Resolve upstream references relative to this skill directory.

Follow the upstream exploration and candidate-report process. Use
`$codebase-design` for its design vocabulary. Use an available skill invocation
mechanism, or read that skill's `SKILL.md` directly; no Claude-specific Skill
tool is required.

For a milestone review, finish the survey before the challenge stage in the
review plan. Keep its candidate discussion for after that stage. Honor an
explicit survey-only request without starting an interview or editing docs.

Use `$grilling` for unresolved choices and `$domain-modeling` for accepted
terms and decisions when the user proceeds to candidate design. The default
visual report remains a temporary HTML artifact; a requested Markdown report
replaces it. Read `HTML-REPORT.md` only for HTML output.
