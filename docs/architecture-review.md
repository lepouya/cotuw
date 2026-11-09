# Architecture review

## Installed skills

Project skills live in `.agents/skills/`, linked from `.claude/skills`.
Each entry point applies project adaptations to pinned upstream instructions.
[Source provenance](../.agents/skills/sources.json) records commits, licenses,
paths, and hashes. Keep imported files unchanged unless deliberately updating
that pinned source.

- [$improve-codebase-architecture][survey]: explicit-only architecture survey
  with candidate improvements. Reports default to temporary HTML; request
  Markdown when useful.
- [$seam-ripper][seam]: independent assessment of dependencies, boundaries,
  contracts, and substantial redesigns within the review's compatibility bounds.
- [$reviewing-code-modularity-skill][modularity]: challenge findings, compare
  interventions, design interfaces, or implement a scoped refactor.
- [$architectural-refactor][refactor]: execute a selected assessment in ordered,
  verified chunks, maintaining current state across sessions.
- [$code-simplifier][simplifier]: clarify changed code within the agreed scope.
- [$codebase-design][design]: module vocabulary and testable interfaces.
- [$grilling][grilling]: resolve material choices after inspecting discoverable
  facts. [$domain-modeling][domain] clarifies terms and records decisions.

Invoke with `$skill-name` or the skill picker. Installation does not execute a
review or authorize changes. Skills other than the survey use normal relevance
matching. The seam-ripper source has no declared upstream license; provenance
preserves that status.

## Project rules

- Follow [AGENTS.md](../AGENTS.md), [README.md](../README.md),
  [DESIGN.md](../DESIGN.md), [TODO.md](../TODO.md), and affected contracts.
  Locked decisions remain requirements; surface conflicts as proposals.
- User scope and existing authorization take precedence over upstream defaults.
  A review or report alone does not authorize implementation or a commit.
- Ground findings in code, callers, and maintenance consequences. Smells,
  pattern names, export counts, and single implementations are leads, not
  proof. Separate evidence from uncertainty; zero findings is valid.
- Compare no change, local repair, and substantial redesign, including
  conversion,
  indirection, and testing costs. Future possibilities alone do not justify a
  framework. Waiving internal compatibility does not waive gameplay contracts.
- Use Markdown lists and concise current-state documentation. DESIGN.md owns
  terminology and locked decisions; focused contracts belong in docs/. Do not
  create a parallel glossary, ADR collection, or historical review log.
- Resolve references within the selected skill. Adapt Claude-specific tool
  requests to available tools or read the installed entry point. Delegate only
  when the user or invoked skill requests it and the environment supports it.
- Preserve unrelated work. Do not require a clean worktree, automatically
  commit, or use broad restore/stash recovery commands. Revise invalid plans
  from evidence rather than silently changing the target.
- Run `npm run check` and affected focused checks under
  [verification](verification.md). Reserve `check:full` for acceptance,
  releases, or an explicit request. Retain distinct behavior coverage when
  replacing tests tied to obsolete interfaces.

## Milestone review sequence

A focused review may use the modularity skill directly. Use companions and the
cleanup pass only when needed.

### 1. Establish scope and compatibility

Record subsystem/task or commit range, revision, included uncommitted changes,
callers, contracts, tests, upcoming work, and inspection gaps. Give both
assessors the same stable snapshot and compatibility bounds.

Permit proposals to replace internal interfaces where justified; migrate all
affected callers together. Apply [persistence policy](../DESIGN.md#persistence):
M1 development permits compatibility breaks without migrations or legacy
rulesets, while same-build deterministic continuation remains required. Format
changes need matching version decisions, validation, content, and docs.
Assess compatibility for players, authored content, and mods as well as code.

### 2. Produce independent assessments

Run the survey in survey-only scope, deferring its candidate interview until
after the challenge. Request locations, evidence, benefits, recommendation
strength, and before/after interfaces.

Run seam-ripper separately against the same snapshot. Request a dependency map,
seam findings, target organization, and transformation sequence with conversion
costs. Neither pass changes game code or sees the other's initial conclusions.
Separate assessments do not require parallel agents; acknowledge possible
influence when running sequentially in one conversation.

### 3. Challenge and consolidate

Use modularity mode A with both reports and the code. Verify callers and the
strongest reasonable counter-explanation for each claim. Merge duplicates and
resolve contradictions. Recommend up to four supported candidates, including a
top choice, without filling a quota. Reviewer agreement is not proof.

### 4. Select and design

For the selected candidate, use modularity mode C and codebase-design to state
ownership, hidden implementation, public interface, example callers, preserved
tests, and explicit contract changes. Compare alternatives when consequential;
read `DESIGN-IT-TWICE.md` only when needed.

Resolve material open choices with grilling, respecting existing answers and
inspected facts. Record accepted terms and decisions in their owning docs.
State one coherent target, exclusions, dependencies, completion criteria, and
verification. Review-only scope ends before implementation. A full-workflow
request can authorize selection and implementation together; do not seek the
same permission again. Pause only for unresolved material choices or conflicts
with locked requirements.

### 5. Implement and verify

Use architectural-refactor for substantial work across chunks or sessions, or
modularity mode D for a small local change. Establish existing check results
before editing and make each chunk independently verifiable.

For substantial work, keep `refactor-plan.md` and `refactor-manifest.json`
under `docs/architecture-review/`, containing selected findings, dependencies,
current status, checks, and next action. Read them when resuming. Run required
checks, diagnose failures, and report unavailable verification and uncertainty.

### 6. Clean up and close

Optionally use code-simplifier on changed code while keeping the selected
architecture fixed. Inspect the diff and rerun affected checks after edits.
Finish when completion criteria and verification pass. Report results, risks,
and deferred findings. Keep lasting contracts in their owning docs and pending
work in TODO.md or issues. Remove completed reports, plans, and manifests;
version control owns their history.

## Full-workflow request

> Follow docs/architecture-review.md through review, design, implementation,
> verification, and closure for the selected TODO.md task or subsystem. Include
> existing uncommitted work. Use the survey and seam-ripper for separate
> read-only assessments of the same snapshot, then modularity to challenge
> them. Return concise Markdown findings. Select and implement one coherent
> scope of supported improvements without another approval of that plan.
> Internal interfaces may change; specified gameplay and locked requirements
> remain binding. Preserve persisted formats unless I authorize a change.
> Pause for a locked-decision conflict or material unresolved trade-off;
> continue independent authorized work. Use companion and implementation skills
> only as needed. Run required checks and report results and deferred findings.
> Do not commit.

## Assessment-only request

> Follow stages 1 through 4 for the selected TODO.md task or subsystem at the
> current revision, including uncommitted changes. Use separate survey and
> seam-ripper assessments, then modularity to challenge them. Apply stage 1's
> compatibility bounds. Return Markdown findings and one recommended scope.
> Use companions only as needed. Leave game code unchanged.

[survey]: ../.agents/skills/improve-codebase-architecture/SKILL.md
[seam]: ../.agents/skills/seam-ripper/SKILL.md
[modularity]: ../.agents/skills/reviewing-code-modularity-skill/SKILL.md
[refactor]: ../.agents/skills/architectural-refactor/SKILL.md
[simplifier]: ../.agents/skills/code-simplifier/SKILL.md
[design]: ../.agents/skills/codebase-design/SKILL.md
[grilling]: ../.agents/skills/grilling/SKILL.md
[domain]: ../.agents/skills/domain-modeling/SKILL.md
