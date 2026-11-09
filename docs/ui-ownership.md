# UI ownership

[DESIGN.md](../DESIGN.md#ui-module-ownership) owns the direction. These
contracts
cover module interfaces, private DOM, asynchronous work, and cleanup.

## Composition

- `src/main.ts` composes audio, application operations, shell roots, UI, and
  shortcuts. Session creation stays dynamically imported so title controls work
  before the renderer loads. UI modules do not import the session.
- `src/application.ts` owns platform creation, the active mission, level
  registry, restart source, replacement, persistence operations, load validity,
  and menu view data. It uses callbacks instead of querying UI elements.
- `src/session.ts` owns simulation, rendering, world input, command controls,
  and exclusive world tools. It receives typed controls and publishes
  player-visible state, guides, alerts, and results; it does not manage saves
  or menu panels.
- Features own their markup, CSS, listeners, overlays, timers, and disposal.
  Composition passes roots, view data, and semantic callbacks. A feature queries
  only its root and owned overlays. Public IDs and accessible names are browser
  test contracts.

## Application and mission lifetime

- Loading parses and validates before releasing the active session. Newer loads,
  restart, return to title, leaving Load, closing the menu, and Inspect/Resume
  invalidate pending reads through the application. Panel revisions alone
  cannot prevent an obsolete read from replacing a mission.
- Check load validity before changing the restart source or starting a session.
  Replacement clears active references and invalidates callbacks before awaiting
  disposal. Release the old session completely before acquiring its replacement.
- Register partial UI ownership before awaiting session creation. Startup
  failure releases partial resources through the same reset path. Cleanup
  failure clears references and leaves title navigation usable. Only the active
  mission generation may publish callbacks or background-save feedback.
- `mission-loading.ts` owns headless preparation; `saves.ts` owns storage order
  and metadata; platform adapters own storage and file dialogs. Exit waits for
  requested save writes/deletions. `save-policy.ts` maps scenario policies to
  availability and autosave schedules.

## Dialogs and navigation

- `ui/dialogs.ts` owns menu/guide markup, panels, focus, dismissal, pending
  guides, busy presentation, and pause restoration. It receives menu view data,
  application callbacks, narrow pause/guide actions, and mixer settings/status.
  It never receives simulation, storage, or rendering internals.
- `createDialogs(host, options)` returns `showMenu(view)`, `offerGuide(popup)`,
  `report(message)`, `setBusy(busy)`, `resetMission()`, and `dispose()`.
  `showMenu` covers title, pause, loaded inspection, results, and exit. Callers
  never invoke native modal methods or choose private focus targets.
- Opening a menu mode chooses initial focus. Routine status/busy updates keep
  panel, form values, and usable focus. Combined application, panel, and action
  eligibility determines availability; clearing busy cannot enable a forbidden
  Load, Save, or Resume action.
- Menus and guides remember prior playing state and restore it when appropriate.
  Loaded Inspect stays paused; explicit Resume or permitted free play continues.
  Continuation comes from view data, not result kind alone. Guides preserve
  placement. Reset closes dialogs and invalidates pending work before
  replacement
  without resuming or dismissing a guide in the departing session.
- One modal owns focus. Guides wait behind menus; results preempt guides.
  Escape leaves an inner panel, then closes only a pause menu. Title,
  inspection,
  and results stay open. Close restores a usable opener or canvas focus. A
  preempted guide cannot resume play or return before permitted continuation.
- `ui/save-panel.ts` owns names, list rows, deletion confirmation, compatibility
  messages, and local pending/errors through list/load/save/import/export/delete
  callbacks. `data-requires-save` connects controls to dialog availability.
  `missionIncompatibility` supplies reasons; the panel adds no format rules.
- Panel revisions suppress late updates after navigation; mission identity
  independently guards session work. Clear feedback on panel changes and finish
  loading indicators on success, failure, or invalidation. Panel work returns
  its result locally rather than duplicating application notifications.
- `ui/mission-setup.ts` owns faction/difficulty choice and emits `start`.
  Panels supply content, opening focus, and optional replacement text.
  `ui/mission-result.ts` supplies shared result text and actions.
- `ui/audio-controls.ts` owns settings markup, binding, and CSS. Dialogs mount
  and dispose it; bootstrap owns the mixer. Keep one application-lifetime
  subtree
  across menus and mission resets to retain focus, values, and subscriptions.

## Sidebar and mission controls

- `createSidebar(root, options)` returns `controls`, `update(state)`,
  `showActor(actor)`, `showGoals()`, and `dispose()`. One sidebar serves both
  factions using content, shared resource definitions, and player-visible state.
  `content-roles.ts` resolves labels from faction and producer-worker roles.
- `sidebar-context.ts` owns shared types and mission-lifetime lookups.
  Sections expose `update(state)` and own native DOM and adjacent CSS:
  - `sidebar-navigation.ts`: header, tabs, panels, and focus movement.
  - `sidebar-production.ts`: construction/training cards, roster, and hosts.
    Construction uses the player roster; training uses the owned producer's
    roster, including actors of another faction type.
  - `sidebar-selection.ts`: inspection, worker, rally, and queue hosts.
  - `sidebar-goals.ts`: briefing and objectives.
  - `sidebar-orders.ts`: placement and order controls.
- Economy, rally, and network binders receive typed controls; each action has
  one binding owner. Cards and keyed lists retain unchanged nodes, focus, and
  disclosure state. `createKeyedList` releases removed rows and their listeners.
  Display authored content as text. Disabled cards retain explanations.
- `simulation.viewOf(playerOwner)` owns visibility and private economy rules.
  UI never reconstructs them from unrestricted state. Issuer-scoped feedback
  excludes other owners' command outcomes.
- `ui/world-shortcuts.ts` routes physical `KeyboardEvent.code` through one
  ordered handler list per key. Escape precedence is Pan, placement, targeting
  and camera focus, selection, then menu. Dialogs and contextual overlays take
  their keys in capture; world shortcuts respect the input guard. Audio unlock
  and modal-local keys remain available inside dialogs. Held camera navigation
  belongs to `render/camera.ts`.
- `ui/building-placement.ts` owns the tool; `render/placement-preview.ts` draws
  it. World modules expose actions instead of installing competing shortcuts.
- `ui/top-bar.ts` owns top-bar markup/state. `ui/notifications.ts` owns alerts
  and supplies the toggle hosted there. `ui/mission-alerts.ts` derives grouped
  alerts through the owner view.
- `ui/camera-controls.ts` mounts once and binds each session's camera, retaining
  Edge panning between missions. The shell owns minimap canvas/sizing;
  `render/minimap.ts` owns drawing and pointer input.

## Markup and styles

- `index.html` owns the shell, canvases, and feature roots. `styles.css` owns
  typography, defaults, `[hidden]`, viewport sizing, title backdrop, and the
  renderer-created `.selection-box`. Rendering imports no CSS.
- Features import adjacent CSS scoped to their roots and owned overlays,
  including portaled tooltips. Shell breakpoints allocate space; features own
  internal scrolling, density, compact layout, and pinned orders. Split media
  rules by owner while preserving cascade order.
- Share button treatment, muted/eyebrow text, and `.action-row`. Keep the plain
  DOM stack; no generic widget registry, framework, or design-system dependency.

## Cleanup and asynchronous work

- Bootstrap owns application UI, mixer, and shortcuts. Session replacement
  resets dialogs, notifications, and camera callbacks. Mission sidebar and
  command bindings release before replacing markup; canvases outlive engines.
- `mountFeature` in `ui/dom.ts` supplies rendering, scoped lookup, abort signal,
  and lifetime. Register cleanup immediately. Failed setup releases partial
  resources and markup; disposal is idempotent. Sidebar sections create elements
  under their parent's lifetime.
- Dialog disposal cancels pending loads and UI publication, removes owned DOM,
  and never resumes, dismisses guides, or starts a mission. Roots and mixer
  remain the parent's responsibility.
- Requested storage mutations finish in library order even after panel or
  session disposal. Cancellation suppresses stale publication, not writes.
  Separate panel pending state from application startup/teardown busy state.

Application and session composition share substantial closure state. Extract
parts when they own independent state or behavior, rather than splitting files
by size and forwarding the same dependencies.

## Verification

Use [coverage ownership](verification.md#coverage-ownership) to select checks.
Dialog, start-screen, save, and session-lifecycle specs cover focus, modal
precedence, stale work, rollback, replacement, and disposal. Sidebar,
production,
economy, Circle, relationship, and observation specs cover content, controls,
compact layout, and information isolation. Audio specs cover settings and unlock
across menus and resets. Headless tests own state transitions independent of
native dialogs, real focus, and layout.
