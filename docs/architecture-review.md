# Architecture review

## Installed skills

Eight project skills live in `.agents/skills/`. Each has a callable `SKILL.md`,
the unchanged upstream prompt in `UPSTREAM.md`, and its supporting resources.
The entry point loads the upstream instructions and applies the project rules
below. [Source provenance](../.agents/skills/sources.json) records commits,
licenses, paths, and SHA-256 hashes for the unchanged files.

Primary skills:

- [$improve-codebase-architecture][survey]: survey structural friction and
  present candidate improvements. Its upstream invocation policy is
  explicit-only. By default it produces a temporary visual HTML report;
  request Markdown when that is preferable.
- [$seam-ripper][seam]: independently examine dependencies, boundaries, and
  contracts, including substantial redesigns under the review's compatibility
  bounds. Its upstream source declares no license; the provenance preserves
  that status without assigning it another source's license.
- [$reviewing-code-modularity-skill][modularity]: challenge evidence, compare
  interventions, design a selected interface, or implement a scoped refactor.
- [$architectural-refactor][refactor]: execute a selected assessment through
  ordered, verified chunks with persistent current state.
- [$code-simplifier][simplifier]: clean up changed code within an authorized
  scope. This adapts Anthropic's agent prompt to Codex and local conventions;
  it does not require the upstream Claude model or React preferences.

Companion skills:

- [$codebase-design][design]: shared vocabulary, testable seams, and alternative
  interfaces for a selected candidate.
- [$grilling][grilling]: resolve material open design choices through questions
  after inspecting the code for discoverable facts.
- [$domain-modeling][domain]: clarify terminology and record accepted decisions
  in the documentation that already owns them.

Invoke these with `$skill-name` or select them from the skill picker. Except for
the survey's explicit-only policy, skills retain normal relevance matching.
New skills should be available on the next turn; restart Codex if they do not
appear. See the [official skill documentation][skill-docs] for discovery rules.
Installation alone does not execute a review or authorize code changes.

## Project rules

These rules apply to every installed review skill and its upstream references:

- Follow [AGENTS.md](../AGENTS.md), [README.md](../README.md),
  [DESIGN.md](../DESIGN.md), and the relevant runtime or content contracts.
  Locked decisions remain requirements. Surface conflicts as proposals.
- Apply the user's task scope and existing authorization before upstream
  defaults. Assessments leave implementation unchanged. Report generation and
  candidate discussion do not authorize a refactor or commit.
- Map upstream glossary and ADR conventions to existing ownership. DESIGN.md
  owns domain terminology and locked decisions; focused supporting documents
  belong in docs/. Edit current text rather than maintaining a historical log.
- Resolve references within the selected skill. When upstream asks for a
  Claude-specific Skill tool, invoke the installed companion through the
  available mechanism or read its SKILL.md. Delegate only when the user or the
  invoked skill requests it and the environment supports it.
- Ground findings in inspected code, callers, and maintenance consequences.
  Smells, pattern names, export counts, and single implementations are leads,
  not proof. Separate demonstrated facts from uncertainty. Zero findings is
  valid. Use Markdown lists rather than upstream example tables.
- Respect declared compatibility bounds. Waiving internal API compatibility
  does not waive specified gameplay or locked technical requirements. Update
  all affected callers together during implementation.
- Preserve unrelated work. Do not require a clean worktree, automatically
  commit, or use upstream's broad restore/stash recovery commands. Diagnose
  failed checks and revise invalid plans within the authorized scope.
- Follow the entry points' adaptations for reporting, documentation, and
  verification. Keep upstream files unchanged; update their provenance only
  when deliberately importing a new pinned revision.

## Milestone review sequence

Use the sequence for milestone maintenance. A focused modularity review can use
the modularity skill directly without running the entire sequence. Companion
skills and the final cleanup pass apply only when their work is needed.

### 1. Establish scope and compatibility

Record the milestone, subsystem or commit range, exact revision, and included
uncommitted changes. Identify relevant callers, tests, contracts, and concrete
upcoming work. Record inspection gaps rather than treating them as a clean
review. Give both assessors this same scope and code snapshot.

For an end-of-M0 assessment:

- Allow proposals that replace internal interfaces and reorganize ownership.
  Compare local repair with substantial redesign where the evidence warrants
  it; compatibility layers for obsolete internal callers need not be retained.
- Apply the [persistence policy](../DESIGN.md#persistence). M0 does not require
  cross-build save migration. A format change still needs a deliberate version
  decision and matching content, validation, and documentation updates.
- Preserve specified gameplay and locked technical requirements. Consult
  [runtime contracts](runtime-boundaries.md) for affected boundaries.
- Justify generalization using existing friction or committed requirements.
  The possibility of future systems does not justify a speculative framework.

At later milestones, assess compatibility by the consumers of each contract,
including players, authored content, and mods, rather than milestone number
alone. These assessment bounds do not authorize implementation.

### 2. Produce independent assessments

Invoke `$improve-codebase-architecture` in survey-only scope. It examines change
hot spots and shallow modules using `$codebase-design` vocabulary, then presents
candidate improvements with locations, benefits, recommendation strength, and
before/after sketches. Defer its candidate interview until after the challenge.
Use the default temporary HTML report or explicitly request Markdown.

Invoke `$seam-ripper` separately against the same snapshot and compatibility
bounds. Require its dependency map, seam findings, target organization, and
transformation sequence. Include conversion cost even for breaking redesigns.
Do not feed either assessor the other's initial conclusions.

Both passes leave game code unchanged. Independence means separate initial
assessments; it does not require parallel agents. If working sequentially in one
conversation, acknowledge that prior findings can influence the second pass.

### 3. Challenge and consolidate

Give both reports and the original code to `$reviewing-code-modularity-skill`
in mode A. Verify callers and the strongest reasonable counter-explanation for
each claim. Compare no change, local repair, and substantial redesign, including
new indirection, migration, and testing costs.

Merge duplicate findings and resolve contradictory proposals. Distinguish
impact, evidence, and existing debt. Recommend up to four supported candidates,
including a top recommendation, without filling a quota. Agreement between
reviewers is not proof; explain the code evidence that survives the challenge.

### 4. Select and design

For a selected candidate, use modularity mode C and `$codebase-design` to state
ownership, hidden implementation, public surface, example callers, tests that
should survive, and explicit contract changes. Compare materially different
interfaces when the decision is consequential. Read `DESIGN-IT-TWICE.md` only
when that comparison earns its cost.

Use `$grilling` for unresolved choices whose answers affect the design. Respect
answers already supplied and inspect discoverable facts before asking. Use
`$domain-modeling` when accepted terminology or decisions need documentation.
Record locked decisions in DESIGN.md once settled.

Produce one coherent target, selected findings, exclusions, completion criteria,
and verification expectations. A review-only request ends here. Implementation
requires authorization for its scope and contract changes. A full-workflow
request can authorize selecting and implementing supported improvements in the
same session. State the selected plan, then proceed within that authorization;
do not ask for the same permission again. Pause only for material choices that
project requirements and the task do not resolve.

### 5. Implement and verify

Use `$architectural-refactor` for work spanning chunks or sessions. For a small
local change, use modularity mode D instead. Establish existing check results
before editing and keep each chunk independently verifiable.

For substantial work, maintain `refactor-plan.md` and `refactor-manifest.json`
under `docs/architecture-review/`. Keep selected findings, dependencies, current
status, check results, and the next action there. Version control owns history.
Read the current plan and manifest when resuming.

Run affected tests, lint, and type checks per chunk. Run `npm run check` before
finishing a coding task and `npm run check:full` before an authorized commit.
Retain distinct behavior coverage when replacing tests tied to old interfaces.
Report unavailable checks and remaining uncertainty. Revise a failed plan based
on evidence rather than silently changing its target or skipping verification.

### 6. Clean up and close

Optionally invoke `$code-simplifier` on the refactor's changed code only. Keep
the selected architecture fixed; report new structural concerns separately.
Inspect its diff and rerun affected checks and `npm run check` after edits.

Finish when selected findings meet their completion criteria and required
checks pass. Report results, remaining risks, and deferred findings. Reopen the
design only for new evidence or an explicit scope change.

## Full-workflow request

> Follow docs/architecture-review.md through review, design, implementation,
> verification, and closure for the completed M0 slice. Account for existing
> uncommitted work. Use $improve-codebase-architecture and $seam-ripper for
> separate initial assessments of the same snapshot, then use
> $reviewing-code-modularity-skill to challenge and consolidate the findings.
> Keep those assessment passes read-only and return concise Markdown findings.
> Select and implement one coherent scope of high-value supported improvements;
> you have permission to proceed without another approval of that plan.
> Apply the M0 bounds: internal interfaces may change, while specified gameplay
> and locked requirements remain binding. Preserve persisted formats unless I
> authorize a format change. Pause for a conflict with a locked decision or a
> material unresolved trade-off; continue independent authorized work.
> Use companion skills, $architectural-refactor, and $code-simplifier only where
> their work is needed. Reuse inspected context and concise findings, checking
> affected code again after edits. Run the required verification, report results
> and deferred findings, and stop when the selected scope is complete. Do not
> commit changes.

Keep the assessment snapshot stable until both initial passes finish. Carry
their findings into design and implementation in the same session; a stage
boundary does not require a fresh session or another whole-codebase scan.
Reread code to resolve a named uncertainty or verify an affected change. Keep
reports and implementation tracking proportional to the selected work.

## Assessment-only request

> Follow docs/architecture-review.md stages 1 through 4 for the completed M0
> slice at the current revision, accounting for uncommitted changes. Use
> $improve-codebase-architecture and $seam-ripper for separate initial
> assessments, then $reviewing-code-modularity-skill for the challenge. Apply
> the M0 compatibility bounds. Return Markdown reports and leave game code
> unchanged. Recommend one coherent scope. Use companion skills only as needed;
> do not implement changes.

[survey]: ../.agents/skills/improve-codebase-architecture/SKILL.md
[seam]: ../.agents/skills/seam-ripper/SKILL.md
[modularity]: ../.agents/skills/reviewing-code-modularity-skill/SKILL.md
[refactor]: ../.agents/skills/architectural-refactor/SKILL.md
[simplifier]: ../.agents/skills/code-simplifier/SKILL.md
[design]: ../.agents/skills/codebase-design/SKILL.md
[grilling]: ../.agents/skills/grilling/SKILL.md
[domain]: ../.agents/skills/domain-modeling/SKILL.md
[skill-docs]: https://learn.chatgpt.com/docs/build-skills
