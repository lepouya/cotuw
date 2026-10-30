import "./styles.css";
import { version } from "../package.json";
import { createApplication } from "./application";
import { createAudioMixer } from "./audio/mixer";
import { createDialogs } from "./ui/dialogs";
import { isTextEntry, worldInputAvailable } from "./render/input-focus";
import { createNotifications } from "./ui/notifications";
import { createTopBar } from "./ui/top-bar";
import { errorMessage } from "./errors";

const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const canvas = byId<HTMLCanvasElement>("game-canvas");

const notifications = createNotifications(document);
const audio = createAudioMixer();
// Dialog and top bar actions run only after the application below exists.
const dialogs = createDialogs(byId("game-dialogs"), {
  version,
  audio,
  mission: () => app.session(),
  focusWorld: () => canvas.focus({ preventScroll: true }),
  notify: notifications.message,
  cancelLoad: () => app.cancelLoad(),
  start: (faction) => app.startFaction(faction),
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
  togglePause: () => app.togglePause(),
  setSpeed: (speed) => app.setSpeed(speed),
  showObjectives: () => app.showObjectives(),
});
const app = createApplication({
  canvas,
  minimap: byId<HTMLCanvasElement>("minimap"),
  audio,
  roots: {
    sidebar: byId("game-sidebar"),
    cameraControls: byId("camera-controls"),
  },
  dialogs,
  notifications,
  topBar,
  setTitleScreen: (atTitle) =>
    document.body.classList.toggle("at-title", atTitle),
});

byId("open-menu").addEventListener("click", app.openMenu);
// F5 and F10 would otherwise reload the page or focus the browser menu.
window.addEventListener("keydown", (event) => {
  const action = {
    F5: app.quicksave,
    F9: app.quickload,
    F10: app.openMenu,
  }[event.key];
  if (!action) return;
  event.preventDefault();
  if (!event.repeat && app.ready() && worldInputAvailable(document))
    void Promise.resolve(action()).catch((error) =>
      dialogs.report(errorMessage(error)),
    );
});
// Windows fires contextmenu after release, once the radial menu is under the
// cursor. Text fields keep the native menu for clipboard actions.
document.addEventListener("contextmenu", (event) => {
  if (!isTextEntry(event.target)) event.preventDefault();
});

// Explicit level links remain available for authoring and browser checks.
void app.initialize(new URLSearchParams(location.search).get("level"));
