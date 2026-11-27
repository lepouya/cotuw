// Twilight overcast sky with perspective-foreshortened billowing cloud decks
// and a warm sunset break peeking behind the alpine pass.
import { clamp, HEIGHT, mix, smoothstep, WIDTH } from "./canvas.ts";

import type { Canvas, Noise2D } from "./canvas.ts";

export function renderSky(canvas: Canvas, noise: Noise2D): void {
  const skyHorizonY = Math.ceil(HEIGHT * 0.39);
  for (let y = 0; y < skyHorizonY; y++) {
    const ny = y / HEIGHT;
    const v = ny / 0.39;
    const perspY = Math.pow(Math.max(0.014, ny), 0.66) * 6.8;

    for (let x = 0; x < WIDTH; x++) {
      const nx = x / WIDTH;

      // Cool slate-navy zenith transitioning to misty steel-blue horizon.
      let r = mix(0.068, 0.25, smoothstep(0, 0.9, v));
      let g = mix(0.11, 0.33, smoothstep(0, 0.9, v));
      let b = mix(0.165, 0.44, smoothstep(0, 0.9, v));

      const leftDim = mix(0.42, 1.0, smoothstep(0.04, 0.5, nx));
      r *= leftDim;
      g *= leftDim;
      b *= leftDim;

      // Focused sunset glow peeking through breaks behind the central-right pass
      // and at the far right edge above the massif.
      const passGlow =
        Math.exp(-Math.pow((nx - 0.58) * 5.2, 2)) *
        Math.exp(-Math.pow((ny - 0.195) * 23.0, 2));
      const upperBreak =
        Math.exp(-Math.pow((nx - 0.655) * 7.2, 2)) *
        Math.exp(-Math.pow((ny - 0.135) * 24.0, 2)) *
        0.58;
      const rightBreak =
        Math.exp(-Math.pow((nx - 0.97) * 7.8, 2)) *
        Math.exp(-Math.pow((ny - 0.08) * 21.0, 2)) *
        0.72;
      const warm = passGlow + upperBreak + rightBreak;
      r += warm * 0.56;
      g += warm * 0.25;
      b += warm * 0.12;

      // High wispy cirrus streaks catching dusk light near the horizon.
      const cirrus = noise.fbm(nx * 9.5 + 3.2, perspY * 3.8, 3) * 0.5 + 0.5;
      const cirrusBand =
        smoothstep(0.48, 0.78, cirrus) *
        smoothstep(0.06, 0.22, ny) *
        smoothstep(0.32, 0.18, ny);
      r += cirrusBand * (0.05 + warm * 0.28);
      g += cirrusBand * (0.06 + warm * 0.14);
      b += cirrusBand * (0.09 + warm * 0.08);

      // Lower billowing stratocumulus cloud deck with directional underside shading.
      const warpX = noise.fbm(nx * 2.4, perspY * 0.8, 3) * 0.9;
      const warpY = noise.fbm(nx * 3.0 + 9.2, perspY * 1.05, 3) * 0.45;
      const cx = nx * 5.1 + warpX;
      const cy = perspY * 2.05 + warpY;

      const cBase = noise.fbm(cx, cy, 5) * 0.5 + 0.5;
      const cBelow = noise.fbm(cx, cy + 0.14, 3) * 0.5 + 0.5;
      const cFine = noise.fbm(cx * 3.2 + 14.1, cy * 2.9, 3) * 0.5 + 0.5;
      const cloudMass = cBase * 0.68 + cFine * 0.32;
      const density = smoothstep(0.24, 0.72, cloudMass);

      // Self-shadowing: thicker cloud undersides are darker slate; lower-facing edges near
      // the sunset break catch coral-peach rim light.
      const puffRelief = clamp(0.5 + (cBase - cBelow) * 2.6, 0, 1);
      const cloudEdge =
        smoothstep(0.22, 0.46, cloudMass) *
        (1 - smoothstep(0.48, 0.76, cloudMass));
      const rim =
        (passGlow * 1.25 + upperBreak * 1.1 + rightBreak) *
        (0.22 + cloudEdge * 1.65 + (1 - puffRelief) * 0.45);

      const cr =
        mix(0.072, 0.25, puffRelief * 0.65 + cFine * 0.35) * leftDim +
        rim * 0.48;
      const cg =
        mix(0.118, 0.32, puffRelief * 0.65 + cFine * 0.35) * leftDim +
        rim * 0.23;
      const cb =
        mix(0.178, 0.42, puffRelief * 0.65 + cFine * 0.35) * leftDim +
        rim * 0.14;

      // Narrow breaks in the cloud deck let the warm horizon glow shine through.
      const breakHole = clamp(
        1 - (passGlow * 0.68 + upperBreak * 0.55 + rightBreak * 0.5),
        0.26,
        1,
      );
      const cloudAlpha = density * smoothstep(0.98, 0.08, v) * 0.93 * breakHole;

      const i = (y * WIDTH + x) * 3;
      canvas.data[i] = mix(r, cr, cloudAlpha);
      canvas.data[i + 1] = mix(g, cg, cloudAlpha);
      canvas.data[i + 2] = mix(b, cb, cloudAlpha);
    }
  }
}
