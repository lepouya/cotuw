import { CONTROL_GROUP_SLOTS } from "../simulation/mission-file";
import { hasOwn, isRecord } from "../simulation/validation";
import { devicePreferences } from "./device-preferences";

type Binding = { chord: string; keyLabel?: string };
type Shortcut = {
  id: string;
  name: string;
  chord: string;
  duringPlacement?: boolean;
};

const STORAGE_KEY = "cotuw.keyboard.settings";

export const PRODUCTION_SHORTCUTS = ["Q", "W", "E", "R", "T"].map(
  (key, index) => ({
    id: `production-${index + 1}` as const,
    name: `Production slot ${index + 1}`,
    chord: `Key${key}`,
  }),
);

export const GROUP_SHORTCUTS = CONTROL_GROUP_SLOTS.flatMap((slot) =>
  (
    [
      ["recall", "Recall", ""],
      ["add", "Add to", "Shift+"],
      ["assign", "Assign", "Control+Shift+"],
    ] as const
  ).map(([operation, name, modifier]) => ({
    id: `group-${slot}-${operation}` as const,
    name: `${name} group ${slot}`,
    chord: `${modifier}Digit${slot}`,
    slot,
    operation,
  })),
);

export const SHORTCUT_SECTIONS = [
  {
    name: "Commands",
    shortcuts: [
      { id: "attackMove", name: "Attack Move", chord: "KeyA" },
      { id: "stop", name: "Stop", chord: "KeyS" },
      { id: "buildings", name: "Open Buildings", chord: "KeyB" },
      {
        id: "rotate",
        name: "Rotate building",
        chord: "KeyR",
        duringPlacement: true,
      },
      { id: "idleNext", name: "Next idle worker", chord: "Period" },
      { id: "idleAll", name: "Select all idle workers", chord: "Shift+Period" },
    ] as const,
  },
  { name: "Production slots", shortcuts: PRODUCTION_SHORTCUTS },
  { name: "Control groups", shortcuts: GROUP_SHORTCUTS },
] satisfies { name: string; shortcuts: readonly Shortcut[] }[];
export type ShortcutId =
  (typeof SHORTCUT_SECTIONS)[number]["shortcuts"][number]["id"];
type RegisteredShortcut = Shortcut & { id: ShortcutId };

const shortcuts = SHORTCUT_SECTIONS.flatMap(
  ({ shortcuts }): readonly RegisteredShortcut[] => shortcuts,
);
const byId = new Map(shortcuts.map((shortcut) => [shortcut.id, shortcut]));
const defaultBinding = (id: ShortcutId): Binding => ({
  chord: byId.get(id)!.chord,
});

const US_PUNCTUATION: Record<string, string> = {
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  IntlBackslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
};

export const KEYBOARD_LAYOUTS = {
  auto: "Automatic",
  qwerty: "QWERTY (US)",
  azerty: "AZERTY (French)",
  qwertz: "QWERTZ (German)",
};
type Layout = keyof typeof KEYBOARD_LAYOUTS;

const LAYOUT_KEYS: Record<Exclude<Layout, "auto">, Record<string, string>> = {
  qwerty: {},
  azerty: {
    KeyQ: "A",
    KeyW: "Z",
    KeyA: "Q",
    KeyZ: "W",
    KeyM: ",",
    Digit1: "&",
    Digit2: "é",
    Digit3: '"',
    Digit4: "'",
    Digit5: "(",
    Digit6: "-",
    Digit7: "è",
    Digit8: "_",
    Digit9: "ç",
    Digit0: "à",
    Minus: ")",
    BracketLeft: "^",
    BracketRight: "$",
    Backslash: "*",
    IntlBackslash: "<",
    Semicolon: "M",
    Quote: "ù",
    Comma: ";",
    Period: ":",
    Slash: "!",
  },
  qwertz: {
    KeyY: "Z",
    KeyZ: "Y",
    Minus: "ß",
    Equal: "´",
    BracketLeft: "Ü",
    BracketRight: "+",
    Backslash: "#",
    IntlBackslash: "<",
    Semicolon: "Ö",
    Quote: "Ä",
    Period: ".",
    Slash: "-",
  },
};

type LayoutMap = Pick<ReadonlyMap<string, string>, "get">;
type LayoutSource = { getLayoutMap: () => Promise<LayoutMap> };
export type KeyboardPreferences = ReturnType<typeof createKeyboardPreferences>;
export type KeyboardBindings = Pick<
  KeyboardPreferences,
  "label" | "subscribe" | "actionFor"
>;

type KeyStroke = Pick<
  KeyboardEvent,
  "code" | "key" | "altKey" | "metaKey" | "ctrlKey" | "shiftKey"
>;

function keyboardChord({ code, ctrlKey, shiftKey }: KeyStroke) {
  return `${ctrlKey ? "Control+" : ""}${shiftKey ? "Shift+" : ""}${code}`;
}

export function hostShortcut(event: KeyStroke) {
  return (
    event.metaKey ||
    event.altKey ||
    (event.ctrlKey &&
      !/^Control\+Shift\+Digit[0-9]$/.test(keyboardChord(event))) ||
    /^F[0-9]+$/.test(event.code)
  );
}

/** Keep printable keys and the existing group assignment chords. */
function canBind(chord: string) {
  const match = /^(?:(Control)\+)?(?:(Shift)\+)?(\w+)$/.exec(chord);
  const [, control, shift, code] = match ?? [];
  if (!code) return false;
  if (control) return !!shift && /^Digit[0-9]$/.test(code);
  return /^(Key[A-Z]|Digit[0-9])$/.test(code) || hasOwn(US_PUNCTUATION, code);
}

const asRecord = (value: unknown) => (isRecord(value) ? value : undefined);

function keyLabel(value: unknown) {
  return typeof value === "string" && [...value].length === 1 && value.trim()
    ? value
    : undefined;
}

/** The shortcut using `chord` in the given context, other than `except`. */
function boundTo(
  chord: string,
  duringPlacement: boolean,
  binding: (id: ShortcutId) => Binding,
  except?: ShortcutId,
) {
  return shortcuts.find(
    (shortcut) =>
      shortcut.id !== except &&
      !!shortcut.duringPlacement === duringPlacement &&
      binding(shortcut.id).chord === chord,
  );
}

const collision = (
  { id, duringPlacement }: RegisteredShortcut,
  chord: string,
  binding: (id: ShortcutId) => Binding,
) => boundTo(chord, !!duringPlacement, binding, id);

function readSettings(source: string | null) {
  let saved: Record<string, unknown> | undefined;
  try {
    saved = asRecord(JSON.parse(source ?? "null"));
  } catch {
    // Unreadable settings use defaults.
  }
  const layout =
    typeof saved?.layout === "string" && hasOwn(KEYBOARD_LAYOUTS, saved.layout)
      ? (saved.layout as Layout)
      : "auto";
  const values = asRecord(saved?.bindings);
  const candidates = new Map<ShortcutId, Binding>();
  for (const { id } of shortcuts) {
    const value = asRecord(values?.[id]);
    if (typeof value?.chord === "string" && canBind(value.chord))
      candidates.set(id, {
        chord: value.chord,
        keyLabel: keyLabel(value.keyLabel),
      });
  }
  const candidate = (id: ShortcutId) =>
    candidates.get(id) ?? defaultBinding(id);
  // Ignore inconsistent storage as a set so reverting one key cannot create another conflict.
  if (
    shortcuts.some((shortcut) =>
      collision(shortcut, candidate(shortcut.id).chord, candidate),
    )
  )
    candidates.clear();
  return { layout, bindings: candidates };
}

export function createKeyboardPreferences(
  storage?: typeof devicePreferences,
  layoutSource?: LayoutSource,
) {
  let { layout, bindings } = readSettings(storage?.read(STORAGE_KEY) ?? null);
  let automatic: LayoutMap | undefined;
  const listeners = new Set<() => void>();
  const publish = () => listeners.forEach((listener) => listener());
  const save = () => {
    storage?.write(STORAGE_KEY, {
      layout,
      bindings: Object.fromEntries(bindings),
    });
    publish();
  };
  const binding = (id: ShortcutId) => bindings.get(id) ?? defaultBinding(id);
  let layoutRequest = 0;
  const refreshLayout = async () => {
    if (!layoutSource) return;
    const request = ++layoutRequest;
    let resolved: LayoutMap | undefined;
    try {
      resolved = await layoutSource.getLayoutMap();
    } catch {
      // Some hosts expose layout lookup but deny access to it.
    }
    if (request !== layoutRequest) return;
    automatic = resolved;
    publish();
  };
  if (layout === "auto") void refreshLayout();
  return {
    refreshLayout,
    layout: () => layout,
    setLayout(next: Layout) {
      layout = next;
      if (layout === "auto") void refreshLayout();
      save();
    },
    reset() {
      bindings.clear();
      layout = "auto";
      void refreshLayout();
      save();
    },
    label(id: ShortcutId) {
      const { chord, keyLabel: captured } = binding(id);
      const parts = chord.split("+");
      const code = parts.pop()!;
      const fallback = US_PUNCTUATION[code] ?? code.replace(/^(Key|Digit)/, "");
      const key =
        layout === "auto"
          ? (keyLabel(automatic?.get(code)) ?? captured ?? fallback)
          : (LAYOUT_KEYS[layout][code] ?? fallback);
      return [
        ...parts.map((part) => (part === "Control" ? "Ctrl" : part)),
        code.startsWith("Key") &&
        /^\p{Ll}$/u.test(key) &&
        key.toUpperCase().length === 1
          ? key.toUpperCase()
          : key,
      ].join("+");
    },
    actionFor(event: KeyStroke, duringPlacement: boolean) {
      if (hostShortcut(event)) return undefined;
      return boundTo(keyboardChord(event), duringPlacement, binding)?.id;
    },
    rebind(id: ShortcutId, event: KeyStroke) {
      const chord = keyboardChord(event);
      if (hostShortcut(event) || !canBind(chord))
        return "That key combination is reserved or unavailable. Try a letter, number, or punctuation key.";
      const conflict = collision(byId.get(id)!, chord, binding);
      if (conflict) return `Already used by ${conflict.name}.`;
      // Modified presses report shifted characters, not the key's own label.
      const modified = event.shiftKey || event.ctrlKey;
      bindings.set(id, {
        chord,
        keyLabel: modified ? undefined : keyLabel(event.key),
      });
      save();
    },
    /** Calls `listener` now and on each change until `signal` aborts. */
    subscribe(listener: () => void, signal?: AbortSignal) {
      if (signal?.aborted) return () => {};
      const unsubscribe = () => {
        listeners.delete(listener);
        signal?.removeEventListener("abort", unsubscribe);
      };
      listeners.add(listener);
      signal?.addEventListener("abort", unsubscribe, { once: true });
      listener();
      return unsubscribe;
    },
  };
}

export const DEFAULT_KEYBOARD: KeyboardBindings = createKeyboardPreferences();

export function deviceKeyboardPreferences(window: Window) {
  const { keyboard } = window.navigator as Navigator & {
    keyboard?: LayoutSource;
  };
  const preferences = createKeyboardPreferences(devicePreferences, keyboard);
  window.addEventListener("focus", () => {
    // A player may return from changing the operating system keyboard layout.
    if (keyboard && preferences.layout() === "auto")
      void preferences.refreshLayout();
  });
  return preferences;
}
