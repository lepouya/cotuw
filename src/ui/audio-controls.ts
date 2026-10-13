import { AUDIO_CHANNELS, DEFAULT_AUDIO_SETTINGS } from "../audio/mixer";
import type { AudioDevice, AudioSettings, AudioStatus } from "../audio/mixer";
import { isRecord } from "../simulation/validation";

const STORAGE_KEY = "cotuw.audio.settings";

const STATUS_TEXT: Record<AudioStatus, string> = {
  waiting: "Interact to enable audio.",
  ready: "",
  blocked: "Audio is blocked. Interact to try again.",
  unavailable: "Some audio is unavailable. Gameplay remains available.",
};

/** Parses saved preferences, falling back to defaults when any are invalid. */
export function readAudioSettings(source: string | null): AudioSettings {
  try {
    const value: unknown = JSON.parse(source ?? "null");
    const settings = structuredClone(DEFAULT_AUDIO_SETTINGS);
    for (const channel of AUDIO_CHANNELS) {
      const saved = isRecord(value) ? value[channel] : undefined;
      if (
        !isRecord(saved) ||
        typeof saved.muted !== "boolean" ||
        typeof saved.volume !== "number" ||
        !(saved.volume >= 0 && saved.volume <= 1)
      )
        return structuredClone(DEFAULT_AUDIO_SETTINGS);
      settings[channel] = { volume: saved.volume, muted: saved.muted };
    }
    return settings;
  } catch {
    return structuredClone(DEFAULT_AUDIO_SETTINGS);
  }
}

/** Binds the menu's volume and mute controls and unlocks audio on input. */
export function bindAudioControls(
  root: Document,
  device: Pick<AudioDevice, "setSettings" | "unlock" | "onStatus">,
) {
  let settings = structuredClone(DEFAULT_AUDIO_SETTINGS);
  try {
    settings = readAudioSettings(localStorage.getItem(STORAGE_KEY));
  } catch {
    /* Storage may be disabled. */
  }
  device.setSettings(settings);
  const controller = new AbortController();
  const { signal } = controller;
  for (const channel of AUDIO_CHANNELS) {
    const volume = root.getElementById(
      `audio-${channel}-volume`,
    ) as HTMLInputElement;
    const mute = root.getElementById(
      `audio-${channel}-mute`,
    ) as HTMLButtonElement;
    const svg = root.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const speaker = root.createElementNS(svg.namespaceURI, "path");
    speaker.setAttribute("d", "M11 5 6 9H3v6h3l5 4z");
    const state = root.createElementNS(svg.namespaceURI, "path");
    svg.append(speaker, state);
    mute.replaceChildren(svg);
    const label = channel === "master" ? "all audio" : channel;
    mute.setAttribute("aria-label", `Mute ${label}`);
    const show = () => {
      volume.value = String(Math.round(settings[channel].volume * 100));
      mute.setAttribute("aria-pressed", String(settings[channel].muted));
      mute.title = `${settings[channel].muted ? "Unmute" : "Mute"} ${label}`;
      state.setAttribute(
        "d",
        settings[channel].muted
          ? "m16 9 5 6m0-6-5 6"
          : "M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14",
      );
    };
    const save = () => {
      device.setSettings(settings);
      show();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      } catch {
        /* Playback does not require storage. */
      }
    };
    volume.addEventListener(
      "input",
      () => {
        settings[channel].volume = Number(volume.value) / 100;
        save();
      },
      { signal },
    );
    mute.addEventListener(
      "click",
      () => {
        settings[channel].muted = !settings[channel].muted;
        save();
      },
      { signal },
    );
    show();
  }
  const activate = (event: Event) => {
    if (event.isTrusted) void device.unlock();
  };
  for (const type of ["pointerdown", "keydown"])
    root.addEventListener(type, activate, { capture: true, signal });
  const status = root.getElementById("audio-status")!;
  const unsubscribe = device.onStatus((state) => {
    status.dataset.audioState = state;
    status.textContent = STATUS_TEXT[state];
  });
  return {
    dispose: () => {
      controller.abort();
      unsubscribe();
    },
  };
}
