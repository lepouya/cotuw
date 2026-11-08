# UI ownership

[DESIGN.md](../DESIGN.md#ui-module-ownership) owns the direction. This document
defines the module interfaces and lifetimes of dialogs, application navigation,
save panels, and sidebar sections.

## Composition

- `src/main.ts` composes the application, dialogs, top bar, notifications,
  camera controls, and shortcuts. `src/application.ts` owns platform creation,
  session startup, storage operations, and menu view data. `src/ui/dialogs.ts`
  owns modal interaction and panel state without querying application storage
  or simulation.
- Dialog, mission setup, audio, save-panel, sidebar, top bar, notification,
  camera control, and radial menu styles live beside their modules.
  `index.html` and `src/styles.css` own the shell and minimap canvas. Shell
  breakpoints allocate viewport space; sidebar sections and the top bar own
  compact rules for their contents.
- `createSidebar` accepts a root, content, and selection callback, and returns
  controls, updates, navigation, and disposal. `createGameSession` binds those
  controls to simulation and input. `createProductionCards` owns its tooltip
  and listeners.

## Structure

Each feature owns its DOM subtree, behavior, styles, and cleanup. Composition
passes roots, state, and semantic callbacks. A feature queries only its root
and owned overlays, never another feature's IDs. Public IDs and accessible
names are contracts for browser specs, so changing them is deliberate.
Document/window listeners for input, audio unlock, and overlay dismissal
belong to the subscribing feature's lifetime. World commands use the existing
world input guard and preserve tool, tooltip, and dialog Escape ordering.
Dialogs and contextual UI (tooltips, the radial menu, the camera views popup)
take their keys in the capture phase; world shortcuts then route through
`src/ui/world-shortcuts.ts`.
Audio activation and modal-local input remain available while a dialog is open.

### Bootstrap and mission lifetime

- `src/main.ts` composes audio, application operations, shell roots, and UI.
  It installs application shortcuts and starts the
  initial title or explicit level route. Session code stays dynamically
  imported so title controls work before the renderer loads. Application and
  UI modules use type-only session imports outside that creation path.
- `src/application.ts` owns the active mission/session, level registry,
  resolved restart source, mission replacement, and the validity of pending
  load requests. Its operations are start, load, restart, return to title,
  save/export, and exit. It reports status and state through callbacks; it
  does not query dialog or save-panel elements. `src/save-policy.ts` maps
  each scenario save policy to rules for when saving is allowed and which
  autosaves fall due; a new policy adds one entry there. The sidebar shows
  the scenario briefing from its options.
- Bootstrap supplies the sidebar root and camera controls. Startup mounts the
  sidebar through its feature constructor and passes returned control references
  and cleanup to session assembly. Register partial UI ownership before
  awaiting session creation; startup failure releases it even if the session
  never becomes ready. Session callbacks publish only for the active mission
  generation.
- Loading parses and validates before releasing the current session. A newer
  request, restart, or return to title invalidates older pending reads.
  Leaving Load, closing the menu, or choosing Inspect or Resume also cancels
  the pending load through an application callback. A panel revision alone
  cannot prevent an obsolete read from replacing the mission. Check request
  validity before changing the restart source or starting the loaded mission.
  Replacement clears active references and invalidates mission callbacks before
  awaiting disposal, so departing work cannot publish during cleanup. Failed
  startup uses the same reset and release path, including notification focus.
  Session disposal completes before a replacement acquires its resources.
  Cleanup failures clear application references and leave title navigation
  usable. Exit waits for the save library's requested writes and deletions.
- `src/mission-loading.ts` keeps headless preparation and validation.
  `src/saves.ts` keeps storage ordering and metadata; platform modules keep
  storage and file dialogs. UI features add no second persistence
  implementation.

### Dialogs and navigation

- `src/ui/dialogs.ts` owns the menu and field-guide
  dialogs, their markup, panel transitions, focus, dismissal, pending guide,
  busy presentation, and pause/resume coordination. Menu contents remain
  local to this feature; shared behavior stays inside this module until a
  second caller needs a separate primitive.
- `src/ui/mission-result.ts` turns a mission result into the text and menu
  actions the menu, top bar, sidebar, and placement status share.
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
  Save/load panel rendering is an internal collaborator, not another
  application API.
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
- `src/ui/save-panel.ts` owns save names, list rows, deletion confirmation,
  compatibility messages, and local pending/error presentation, with its
  markup and styles. It receives list/load/save/import/export/delete
  callbacks and runs work through the dialog's panel revision. Controls that
  need a savable mission carry `data-requires-save`, so dialog availability
  applies without naming the panel's IDs.
  Application operations own reading, validation, serialization, and storage.
  Compatibility status comes from `missionIncompatibility`, which applies the
  format, tick-rate, and content-pack checks loading uses; the panel displays
  its reason without duplicating format rules.
  A panel revision prevents late completions from updating a closed or
  replaced panel; mission identity separately guards session work. Panel
  changes clear prior feedback. Save listings show loading state, clearing it
  when listing completes, fails, or is invalidated by navigation. Panel
  operations return their outcome to the requesting panel instead of also
  publishing a generic application message. Background Quick/Auto save
  notifications use the originating mission's identity.
- `src/ui/mission-setup.ts` owns the new-mission panel: difficulty and faction
  choices, with its markup and styles. It reports the choice through `start`.
  Panels share one shape, content plus opening focus and optional replacement
  text, which the dialog module switches between. The Options panel holds the
  audio controls and is where other device preferences mount.
- `src/ui/audio-controls.ts` owns audio settings markup, labels, styles, and
  bindings. Dialog construction mounts this child before binding its controls
  and owns its disposal; bootstrap owns the mixer. One application-lifetime
  instance serves title and mission menus. View updates and mission resets
  keep that subtree mounted, preserving settings, focus, and subscriptions.

### Mission HUD and controls

- `src/ui/sidebar.ts` owns sidebar layout, header, tabs, and section
  composition. Its interface is `createSidebar(root, options)`, returning
  `controls`, `update(state)`, `showActor(actor)`, `showGoals()`, and
  `dispose()`. One sidebar serves both factions. Names, costs, catalogs, and
  actions derive from content, shared resource definitions, and player-visible
  state. `content-roles.ts` names economy roles using the selected definition's
  faction and producer-worker relationships, with the player's faction as
  the default context.
- `sidebar-context.ts` owns sidebar state and option types and the
  mission-lifetime lookups sections share. Each section exposes
  `update(state)`, and `createSidebar` refreshes them through that contract.
- `sidebar-navigation.ts` owns the header, tabs, panel visibility, and focus
  movement between panels.
- `sidebar-production.ts` owns construction and training cards, the field
  roster, and production-panel hosts. Construction follows the player's
  roster; training follows the selected owned producer, including units of
  another faction type. Unaffordable choices retain their explanations.
- `sidebar-selection.ts` owns inspection details and worker, rally, and queue
  hosts. `sidebar-goals.ts` owns briefing and objective rendering.
  `sidebar-orders.ts` owns placement and order-control markup and state.
  Each section creates native elements in TypeScript and imports adjacent CSS.
- Composition obtains typed control references without querying private IDs.
  Economy, rally, and network binders receive those references; each command
  action has one binding owner. Shared production-card and portrait styles
  belong to those features, including portaled tooltips.
- Catalog cards are created once. Actor, economy, and objective rows use
  `createKeyedList` from `src/ui/dom.ts`, retaining unchanged nodes, focus,
  and disclosure state as committed state changes. Removed rows release their
  listeners; list disposal or the owning abort signal releases remaining rows
  and prevents further updates. Displayed content uses text, never authored
  HTML.
- `src/session.ts` owns simulation, rendering, world input, and the command
  controls that depend on them. It coordinates exclusive world tools and
  submits serializable commands. It binds world shortcuts by physical
  `KeyboardEvent.code`, one ordered handler list per key, so Escape
  precedence (Pan mode, placement, targeting and camera focus, selection,
  menu) reads in one place. World modules expose those actions instead of
  listening for them; held camera navigation keys stay in
  `src/render/camera.ts`. `src/ui/building-placement.ts` owns the placement
  tool and `src/render/placement-preview.ts` draws its preview. The session
  receives control references and emits player-visible updates, alerts,
  guides, and results; it does not load saves or manage menu panels.
- `simulation.viewOf(playerOwner)` in `src/simulation/owner-view.ts` remains
  the authority for what the player may see. UI does not reconstruct
  visibility from unrestricted simulation state. Layout changes preserve
  issuer-scoped feedback and private economy rules.
- `src/ui/top-bar.ts` mounts the top bar's markup into `#top-bar` and owns its
  styles and controls. It reads the status it needs from the session's state
  and shows the idle bar without one.
- `src/ui/notifications.ts` mounts the toasts and alert history into
  `#mission-alerts` and creates the alert toggle, which composition passes to
  the top bar to host.
- `src/ui/mission-alerts.ts` turns what the player may know, read through the
  owner view, into grouped alerts.
- `src/ui/camera-controls.ts` mounts its markup into `#camera-controls` once
  for the application, so Edge panning keeps its setting between missions, and
  owns its styles. Each session binds its camera through `bind`.
- The minimap canvas and its sizing stay in the shell; `src/render/minimap.ts`
  draws it and handles its pointer input.

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
- Share the existing button treatment, muted text, eyebrow text, and
  `.action-row` layout. Add no generic widget registry, template engine, UI
  framework, or design-system package.
- Shell CSS owns column widths, viewport allocation, and shell breakpoints.
  Feature CSS owns internal scrolling, card density, local compact rules,
  and pinned orders. Media queries that span owners split by owner, keeping
  their conditions and cascade order.

### Lifetime and asynchronous work

- Bootstrap owns application-lifetime UI, the mixer, and shortcuts.
  Mission replacement resets dialog state, notifications, and camera callbacks.
  Sidebar and command bindings have mission lifetime and release before their
  markup is replaced. Canvas elements outlive the session engine.
- Mount features with `mountFeature` from `src/ui/dom.ts`. It renders owned
  markup and provides a lifetime, an abort signal, and root-scoped lookup.
  Failed setup or disposal empties the root. The sidebar mounts empty markup,
  and its sections create native elements with `createElement` under that
  mission lifetime. Register cleanup immediately; partial construction
  releases acquired resources and owned markup, and disposal is idempotent.
  Portaled overlays and timers belong to the feature that creates them.
  Dialog disposal cancels pending loads and UI publication, and removes its
  owned DOM without resuming play, dismissing guides, or starting missions.
  Mount roots and the mixer remain their parent's responsibility.
- Already-requested storage mutations finish in library order. Disposing a
  panel or replacing a session suppresses stale UI publication, not those
  writes. Separate UI pending state from mission startup/teardown busy state.

## Trade-offs

- Feature-owned DOM and adjacent CSS need explicit mounting and cleanup. They
  keep private IDs and layout out of the document and fit the root-based
  modules.
- A UI framework or general component registry would add dependencies,
  lifecycle conventions, and migration work without solving a requirement
  beyond these roots and callbacks.

## Verification

- `e2e/start-screen.spec.ts`, `e2e/interface.spec.ts`, `e2e/saves.spec.ts`,
  `e2e/dialogs.spec.ts`, and `e2e/session-lifecycle.spec.ts` own lazy renderer
  startup, keyboard focus, Escape, guide pausing, loaded inspection, save retry,
  ordered exit, restart, cleanup after failure, delayed loads and panel work
  after navigation, busy-state release, and deferred guides and result
  precedence.
- `e2e/audio.spec.ts` owns settings, audio unlock inside dialogs, menu
  transitions, mission resets, and binding disposal.
- `e2e/sidebar.spec.ts` and the production-card, economy, Circle, and
  relationship and observation specs own partial-setup cleanup, recreation,
  custom content, pinned orders, touch layouts, and information isolation.
- Headless mission-loading, save-library, lifetime, and presentation tests own
  state transitions independent of real focus, native dialogs, and layout.
- Run `npm run check` and affected browser specs for UI changes, using their
  tagged WebKit and mouse/touch profiles under [verification](verification.md).
