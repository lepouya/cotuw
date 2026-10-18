import { test } from "@playwright/test";
import type { ViewportSize } from "@playwright/test";

/** A viewport and input modality that browser flows are verified with. */
export type BrowserProfile = {
  readonly name: string;
  readonly viewport: ViewportSize;
  readonly touch: boolean;
};

export const MOUSE_PROFILE = {
  name: "mouse",
  viewport: { width: 1280, height: 720 },
  touch: false,
} as const satisfies BrowserProfile;

/** The desktop app's default window. */
export const DESKTOP_WINDOW_PROFILE = {
  name: "desktop window",
  viewport: { width: 800, height: 600 },
  touch: false,
} as const satisfies BrowserProfile;

export const PHONE_PROFILE = {
  name: "phone",
  viewport: { width: 844, height: 390 },
  touch: true,
} as const satisfies BrowserProfile;

export const TABLET_PROFILE = {
  name: "tablet",
  viewport: { width: 1024, height: 768 },
  touch: true,
} as const satisfies BrowserProfile;

/** Compact landscape browser profiles that M0 verifies with touch input. */
export const TOUCH_PROFILES = [PHONE_PROFILE, TABLET_PROFILE] as const;

export const PROFILES = [MOUSE_PROFILE, ...TOUCH_PROFILES] as const;

/** Mouse and phone cover flows whose tablet layout adds no distinct behavior. */
export const MOUSE_AND_PHONE_PROFILES = [MOUSE_PROFILE, PHONE_PROFILE] as const;

/** Declares the tests in `body` once per profile, under its name. */
export function forEachProfile<P extends BrowserProfile>(
  profiles: readonly P[],
  body: (profile: P) => void,
) {
  for (const profile of profiles)
    test.describe(profile.name, () => {
      test.use({ viewport: profile.viewport, hasTouch: profile.touch });
      body(profile);
    });
}
