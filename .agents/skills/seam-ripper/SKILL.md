---
name: seam-ripper
description: >-
  Assess architectural seams, coupling, abstraction leaks, and responsibility
  boundaries. Use for a requested radical architecture assessment, including
  early-project redesigns that may replace internal interfaces.
---

# Seam Ripper

Read the [project rules](../../../docs/architecture-review.md#project-rules)
and then [the upstream instructions](UPSTREAM.md). Apply them within the task
scope, with the project rules and adaptations below taking precedence.
Resolve upstream references relative to this skill directory.

Keep the assessment read-only and apply the review's declared compatibility
bounds. At M0, internal interfaces may be replaced in a proposal; that does not
permit changing gameplay or locked requirements.

Use the upstream dependency map, seam analysis, redesign, and transformation
sequence. Treat its smell heuristics as leads requiring code evidence. Explain
conversion costs even when backward compatibility is waived. Return findings
in Markdown lists rather than its example tables.
