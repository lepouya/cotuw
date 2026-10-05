/** Compact landscape browser profiles that M0 verifies with touch input. */
export const TOUCH_PROFILES = [
  { name: "phone", viewport: { width: 844, height: 390 }, touch: true },
  { name: "tablet", viewport: { width: 1024, height: 768 }, touch: true },
] as const;

export const MOUSE_PROFILE = {
  name: "mouse",
  viewport: { width: 1280, height: 720 },
  touch: false,
} as const;

export const PROFILES = [MOUSE_PROFILE, ...TOUCH_PROFILES] as const;
