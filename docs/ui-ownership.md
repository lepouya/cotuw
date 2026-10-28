# UI ownership

[DESIGN.md](../DESIGN.md#ui-module-ownership) owns the selected direction.
This document defines the implementation boundaries for tasks 1.22-1.24.

## Current coupling

- Dialog transitions require coordinated knowledge in `src/main.ts`:
  `showMenu`, `showPanel`, `showPopup`, and `cancelMenu` control focus and
  visibility, while `start`, `loadFrom`, and `releaseMission` control mission
  lifetime. `resumeOnClose`, popup state, and request counters connect them.
  Task 1.22 needs one owner for those dialog transitions; task 1.23 needs to
  keep session replacement independent of their DOM details.
- `index.html` declares feature internals while `src/styles.css` combines
  shell, dialog, sidebar, card, audio, and viewport rules. Compact-screen
  rules mix shell sizing with feature layout. Tasks 1.22 and 1.24 therefore
  need explicit markup and style ownership as well as TypeScript extraction.
- `createSidebar` already accepts a root, content, and selection callback,
  and returns controls, updates, and disposal. `createGameSession` binds
  those controls to simulation and input. `createProductionCards` owns its
  tooltip and listeners. These are useful seams to retain and refine;
  their existence does not justify replacing the control system.

The first two couplings make each committed UI task touch shared code; they
cause no known gameplay failure. The existing seams limit the refactor to the
parts that need it.

## Selected structure

Each feature owns its DOM subtree, behavior, styles, and cleanup. Composition
passes roots, state, and semantic callbacks. A feature queries only its root
and owned overlays, never another feature's IDs. Existing public IDs and
accessible names remain stable through extraction where behavior is unchanged.
Document/window listeners for input, audio unlock, and overlay dismissal
belong to the subscribing feature's lifetime. World commands use the existing
world input guard and preserve tool, tooltip, and dialog Escape ordering.
Audio activation and modal-local input remain available while a dialog is open.

### Bootstrap and mission lifetime

- `src/main.ts` composes platform services, audio, application operations,
  shell roots, and UI. It installs application shortcuts and starts the
  initial title or explicit level route. Session code stays dynamically
  imported so title controls work before the renderer loads. Application and
  UI modules use type-only session imports outside that creation path.
- `src/application.ts`, extracted in 1.23, owns the active mission/session,
  level registry, resolved restart source, mission replacement, and the
  validity of pending load requests. Its operations are start, load,
  restart, return to title, save/export, and exit. It reports status and
  state through callbacks; it does not query dialog or save-panel elements.
- Bootstrap supplies mission UI roots. Startup mounts the sidebar through
  its feature constructor and passes returned control references and cleanup
  to session assembly. Register partial UI ownership before awaiting session
  creation; startup failure releases it even if the session never becomes
  ready. Session callbacks publish only for the active mission generation.
- Loading parses and validates before releasing the current session. A newer
  request, restart, or return to title invalidates older pending reads.
  Leaving Load, closing the menu, or choosing Inspect or Resume also cancels
  the pending load through an application callback. A panel revision alone
  cannot prevent an obsolete read from replacing the mission. Check request
  validity before changing the restart source or starting the loaded mission.
  Session disposal completes before a replacement acquires its resources.
  Cleanup failures clear application references and leave title navigation
  usable. Exit waits for the save library's requested writes and deletions.
- `src/mission-loading.ts` keeps headless preparation and validation.
  `src/saves.ts` keeps storage ordering and metadata; platform modules keep
  storage and file dialogs. UI extraction does not add a second persistence
  implementation or change mission/content versions.

### Dialogs and navigation

- `src/ui/dialogs.ts`, introduced in 1.22, owns the menu and field-guide
  dialogs, their markup, panel transitions, focus, dismissal, pending guide,
  busy presentation, and pause/resume coordination. Menu contents remain
  local to this feature; shared behavior stays inside this module until a
  second caller needs a separate primitive.
- The caller supplies menu view data and semantic callbacks for application
  actions, plus narrow access to current mission pause/resume and guide
  dismissal. The dialog module does not receive the simulation, save storage,
  or engine. It hides element IDs, native dialog events, focus targets, and
  panel visibility from callers.
- Its public surface is `createDialogs(host, options)`, returning
  `showMenu(view)`, `offerGuide(popup)`, `report(message)`, `setBusy(busy)`,
  `resetMission()`, and `dispose()`. `showMenu` covers title, pause, loaded
  inspection, result, and exit views; the view supplies available actions and
  text. Options provide application action callbacks, including load
  cancellation and notifications, and the existing audio device's settings,
  unlock, and status methods. `report` shows status in the open menu and
  otherwise forwards it to notifications. `setBusy` reflects application
  startup and teardown work; panel-local pending state stays internal.
  Save/load panel rendering is an internal collaborator extracted in 1.23,
  not another application API.
- For example, the application routes a session's `onPopup` callback to
  `dialogs.offerGuide(popup)`, routes its result callback to
  `dialogs.showMenu(resultView)`, and calls `dialogs.resetMission()` before
  releasing or replacing that session. Callers never invoke `showModal`,
  close an explanation element, or select a panel's focus target themselves.
- `showMenu` opens a new menu mode and focuses its initial action. Routine
  status and busy updates preserve the active panel and form values. They
  move focus only when its control becomes unavailable or to restore it
  after busy work. Busy state combines with action eligibility and local work;
  clearing it cannot enable an unavailable Load, Save, or Resume action.
- The dialog module records whether the current mission was playing when a
  pause menu or guide opened. Closing that pause menu or guide restores its
  prior state. Loaded Inspect closes without resuming; explicit Resume and
  M0 Continue free play request continuation. Available continuation comes
  from the mission view, not the result kind alone. Guides preserve active
  placement interactions. Reset closes both dialogs, invalidates panel work,
  and clears pending guides and resume intent before session replacement,
  without resuming or recording dismissal in the departing session.
- Only one modal owns focus. Guides wait behind menus; results take precedence
  over contextual guides. Escape returns from an inner panel, then closes
  only the pause menu; title, loaded-inspection, and result screens remain.
  World tools still consume Escape before the session asks to open a menu.
  Closing restores focus to a usable opener or the world canvas. A guide
  preempted by a result cannot resume play when it closes. Any deferred guide
  can return only after an explicitly permitted continuation.
- `src/ui/save-panel.ts`, extracted in 1.23, owns save names, list rows,
  deletion confirmation, compatibility messages, and local pending/error
  presentation. It receives list/load/save/import/export/delete callbacks.
  Application operations own reading, validation, serialization, and storage.
  Compatibility status comes from shared mission/content
  validation; the panel displays its reason without duplicating format rules.
  A panel revision prevents late completions from updating a closed or
  replaced panel; mission identity separately guards session work. Panel
  operations return their outcome to the requesting panel instead of also
  publishing a generic application message. Background Quick/Auto save
  notifications use the originating mission's identity.
- `src/ui/audio-controls.ts` owns audio settings markup, labels, styles, and
  bindings. Dialog construction mounts this child before binding its controls
  and owns its disposal; bootstrap owns the mixer. One application-lifetime
  instance serves title and mission menus. View updates and mission resets
  keep that subtree mounted, preserving settings, focus, and subscriptions.

### Mission HUD and controls

- `src/ui/sidebar.ts` owns sidebar layout, tabs, goals, selection, and roster
  composition. Task 1.24 makes its sections composable within that owner.
  There is one sidebar for both factions, with names, costs, rosters, and
  actions drawn from content and player-visible state.
- Production cards, goals, worker details, and order controls own their
  markup and styles when extracted as sections. Sidebar composition creates
  section hosts and obtains typed control references; it does not discover
  section-private elements by ID. Existing control references may bridge
  staged extraction, but each element has one action binding owner.
- `src/session.ts` owns simulation, rendering, world input, and the command
  controls that depend on them. It coordinates exclusive world tools and
  submits serializable commands. It receives control references and emits
  player-visible updates, alerts, guides, and results; it does not load saves
  or manage menu panels. Existing control binders need no wholesale rewrite.
- `src/simulation/player-view.ts` remains the authority for what the player may
  see. UI does not reconstruct visibility from unrestricted simulation state.
  Layout changes preserve issuer-scoped feedback and private economy rules.
- Top bar, camera controls, minimap host, notifications, and alert history
  remain distinct features. Their owning modules supply markup and styles
  when touched; 1.22 does not require moving every HUD feature at once.

### Markup and shared styles

- `index.html` owns the document entry point, shell, canvas, minimap canvas,
  and feature mount points. Feature modules create their internals before
  binding listeners, using static templates or DOM construction. Dynamic
  content uses text nodes or `textContent`; authored labels are not HTML.
- Feature CSS sits beside its TypeScript and is imported by that feature.
  `src/styles.css` keeps base typography, element defaults, `[hidden]`,
  shell/viewport sizing, and the title backdrop. Feature roots scope local
  selectors; owned overlays such as production tooltips use feature classes
  even when mounted under the document body.
- Share the existing button treatment, muted text, eyebrow text, and action
  row layout. Replace the cross-feature `.building-controls` name with a
  neutral action-row class as affected features move. Add no generic widget
  registry, template engine, UI framework, or design-system package.
- Shell CSS owns column widths, viewport allocation, and shell breakpoints.
  Feature CSS owns internal scrolling, card density, local compact rules,
  and pinned orders. Mixed media-query blocks split by owner while preserving
  their conditions, cascade order, touch targets, and visible behavior.

### Lifetime and asynchronous work

- Bootstrap owns application-lifetime UI, the mixer, and shortcuts.
  Mission replacement resets dialog state, notifications, and camera callbacks.
  Sidebar and command bindings have mission lifetime and release before their
  markup is replaced. Canvas elements outlive the session engine.
- Use `createLifetime` and abortable listeners. Register cleanup immediately;
  partial construction releases acquired resources, and disposal is idempotent.
  Portaled overlays and timers belong to the feature that creates them.
  Dialog disposal cancels pending UI publication and removes its owned DOM
  without resuming play or invoking mission actions. Mount roots and the
  bootstrap-owned mixer remain their parent's responsibility.
- Already-requested storage mutations finish in library order. Disposing a
  panel or replacing a session suppresses stale UI publication, not those
  writes. Separate UI pending state from mission startup/teardown busy state.

## Alternatives and trade-offs

- Keeping static feature markup in `index.html` and only moving TypeScript
  has the lowest conversion cost. It leaves private IDs and feature layout
  shared with the document and does not satisfy feature-owned markup/styles.
- Feature-owned DOM and adjacent CSS add explicit mounting and cleanup work.
  They fit existing root-based modules and localize the committed dialog and
  sidebar changes. This is the selected approach.
- A UI framework or general component registry adds dependencies, lifecycle
  conventions, and migration work without solving a requirement beyond these
  existing roots and callbacks. It is outside the selected scope.

## Implementation and verification

- **1.22:** Extract dialog ownership first, including menu and guide markup,
  local CSS, focus, pause/resume, busy handling, and disposal. Application
  operation callbacks may remain in `main.ts` until 1.23, but their DOM
  rendering and handlers move with the markup into the dialog feature.
  Save-panel extraction in 1.23 splits those private internals. Preserve menu
  actions and save behavior; introduce no skirmish result or autosave rules
  in this move.
- **1.23:** Extract application/session navigation and save-panel presentation.
  Apply its incompatible-save and skirmish save policies with the corresponding
  mission rules. Keep request validity at the owner of each asynchronous action.
- **1.24:** Extract sidebar sections and styles behind the existing root-based
  composition. Retain content-driven faction support and world-control behavior.
- Preserve behavior coverage in `e2e/start-screen.spec.ts`,
  `e2e/interface.spec.ts`, `e2e/saves.spec.ts`, and
  `e2e/session-lifecycle.spec.ts`: lazy renderer startup, keyboard focus,
  Escape, guide pausing, loaded inspection, save retry, ordered exit, restart,
  and cleanup after failure. Extend these for reset during pending work,
  deferred guides, and result precedence where coverage is missing.
- Cover a delayed load resolving after Back, Inspect, Resume, or return to
  title; neither session nor restart source may change. Cover late panel
  success/failure after navigation, busy-state release preserving disabled
  actions, and guide dismissal after a result without accidental resumption.
  Preserve settings coverage in `e2e/audio.spec.ts`; extend it for audio unlock
  inside dialogs, menu transitions, mission resets, and binding disposal
  without duplicate subscriptions.
- For sidebar work, preserve `e2e/sidebar.spec.ts`, production-card,
  economy, Circle, and relationship/observation behavior coverage. Retain
  partial-setup cleanup, recreation, custom content, pinned orders, touch
  layouts, and information isolation. Fixtures may mount the feature instead
  of cloning static markup; behavioral assertions remain.
- Keep headless mission-loading, save-library, lifetime, and presentation tests.
  Add unit tests for extracted state transitions only where they protect
  behavior independently of real focus, native dialogs, and layout.
- Run `npm run check` and affected browser specs for each implementation.
  Use their tagged WebKit and mouse/touch profiles under
  [verification](verification.md). Playtest both faction openings, guide and
  menu cancellation, paused load inspection, save/load/restart, and return to
  title.
