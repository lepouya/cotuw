---
name: codebase-design
description: >-
  Design module interfaces, ownership, and testable seams using the deep-module
  vocabulary. Use for a selected architectural candidate or when the survey
  needs that vocabulary; it is not a whole-codebase audit.
license: MIT
---

# Codebase Design

Read the [project rules](../../../docs/architecture-review.md#project-rules)
and then [the upstream instructions](UPSTREAM.md). Apply them within the task
scope, with the project rules and adaptations below taking precedence.
Resolve upstream references relative to this skill directory.

Use the upstream design vocabulary and principles. Read `DEEPENING.md` for
dependency and testing strategy, and `DESIGN-IT-TWICE.md` only when alternative
interfaces would resolve a material design choice.

Compare alternatives using real callers and committed requirements. Keep tests
that protect distinct specified behavior; replace implementation-coupled tests
only when equivalent behavior coverage exists. A seam or adapter is justified
by actual coupling or test pressure, not by a numerical quota.
