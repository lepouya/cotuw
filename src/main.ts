import "./styles.css";
import { version } from "../package.json";
import { createApplication } from "./application";
import { createAudioMixer } from "./audio/mixer";
import { skirmishLink } from "./content/skirmish";
import { errorMessage } from "./errors";
import { isTextEntry, worldKeyboardAvailable } from "./render/input-focus";
import { createCameraControls } from "./ui/camera-controls";
import { createDialogs } from "./ui/dialogs";
import { createNotifications } from "./ui/notifications";
import { createTopBar } from "./ui/top-bar";

const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const canvas = byId<HTMLCanvasElement>("game-canvas");

const notifications = createNotifications(byId("mission-alerts"));
const audio = createAudioMixer();
// Dialog and top bar actions run only after the application below exists.
const dialogs = createDialogs(byId("game-dialogs"), {
  version,
  audio,
  mission: () => app.session(),
  focusWorld: () => canvas.focus({ preventScroll: true }),
  notify: notifications.message,
  cancelLoad: () => app.cancelLoad(),
  start: (faction, difficulty) => app.startFaction(faction, difficulty),
  restart: () => app.restart(),
  exitToTitle: () => app.returnToTitle(),
  showTitle: () => app.showTitle(),
  quit: () => app.quit(),
  listSaves: () => app.listSaves(),
  removeSave: (id) => app.removeSave(id),
  load: (id) => app.load(id),
  save: (kind, name) => app.save(kind, name),
  export: (name) => app.export(name),
});
const topBar = createTopBar(byId("top-bar"), {
  alertToggle: notifications.toggle,
  openMenu: () => app.openMenu(),
  togglePause: () => app.togglePause(),
  setSpeed: (speed) => app.setSpeed(speed),
  showObjectives: () => app.showObjectives(),
});
// Explicit links remain available for authoring and browser checks.
const link = new URLSearchParams(location.search);
const app = createApplication({
  canvas,
  minimap: byId<HTMLCanvasElement>("minimap"),
  audio,
  sidebarRoot: byId("game-sidebar"),
  cameraControls: createCameraControls(byId("camera-controls")),
  dialogs,
  notifications,
  topBar,
  setTitleScreen: (atTitle) =>
    document.body.classList.toggle("at-title", atTitle),
  // Development links that assign AI also offer its diagnostics.
  aiOverlay: link.has("ai"),
});

const APPLICATION_KEYS = new Map<string, () => unknown>([
  ["F5", app.quicksave],
  ["F9", app.quickload],
  ["F10", app.openMenu],
]);
// F5 and F10 would otherwise reload the page or focus the browser menu.
// Modified presses stay with the host, such as Ctrl+F5's hard reload.
window.addEventListener("keydown", (event) => {
  const action = APPLICATION_KEYS.get(event.code);
  if (
    !action ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey
  )
    return;
  event.preventDefault();
  if (!event.repeat && app.ready() && worldKeyboardAvailable(document))
    void Promise.resolve(action()).catch((error) =>
      dialogs.report(errorMessage(error)),
    );
});
// Windows fires contextmenu after release, once the radial menu is under the
// cursor. Text fields keep the native menu for clipboard actions.
document.addEventListener("contextmenu", (event) => {
  if (!isTextEntry(event.target)) event.preventDefault();
});

void app.initialize({
  level: link.get("level") ?? undefined,
  skirmish: skirmishLink(link),
});
