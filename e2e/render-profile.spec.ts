// Splits the AI benchmark scene's frame time by rendering phase; see
// docs/verification.md.
import { mkdir, writeFile } from "node:fs/promises";
import { openBenchmarkScene } from "./benchmark-scene";
import { test } from "./fixtures";
import { WEBKIT } from "./tags";
import type { Observable } from "@babylonjs/core";

test.skip(
  !process.env.COTUW_PROFILE || !process.env.COTUW_BENCHMARK,
  "Set COTUW_BENCHMARK=1 and COTUW_PROFILE=1 to profile.",
);
test.use({ viewport: { width: 2240, height: 1133 }, deviceScaleFactor: 1 });

/** Settings switched off to see what they cost, beside the unchanged scene. */
const VARIANTS = [
  "baseline",
  ...(process.env.COTUW_PROFILE_VARIANTS?.split(",").filter(Boolean) ?? []),
];

for (const variant of VARIANTS)
  test(
    `render profile: ${variant}`,
    { tag: WEBKIT },
    async ({ page }, info) => {
      test.setTimeout(240_000);
      const module = await openBenchmarkScene(page, "normal");
      await page.evaluate((options) => {
        const benchmark = globalThis.cotuwBenchmark!;
        benchmark.prepare(1, options);
        document.querySelector<HTMLButtonElement>("#resume-mission")!.click();
      }, module.probeOptions("normal"));
      const result = await page.evaluate(async (variant) => {
        const { scene } = globalThis.cotuwBenchmark!;
        const engine = scene.getEngine();
        if (variant === "no-shadows") scene.shadowsEnabled = false;
        if (variant === "no-animation") scene.animationsEnabled = false;
        if (variant === "no-skeletons") scene.skeletonsEnabled = false;
        if (variant === "no-particles") scene.particlesEnabled = false;
        if (variant === "half-resolution") engine.setHardwareScalingLevel(2);
        await new Promise((resolve) => setTimeout(resolve, 8_000));
        // Milliseconds each phase spends per frame, between paired observables.
        const phases: Record<string, number[]> = {};
        const timers: (() => void)[] = [];
        const time = <Start, End>(
          name: string,
          start: Observable<Start>,
          stop: Observable<End>,
        ) => {
          let began: number | undefined;
          const samples: number[] = (phases[name] = []);
          const a = start.add(() => (began = performance.now()));
          const b = stop.add(() => {
            if (began === undefined) return;
            samples.push(performance.now() - began);
            began = undefined;
          });
          timers.push(() => {
            start.remove(a);
            stop.remove(b);
          });
        };
        time(
          "engineFrame",
          engine.onBeginFrameObservable,
          engine.onEndFrameObservable,
        );
        time(
          "sceneRender",
          scene.onBeforeAnimationsObservable,
          scene.onAfterRenderObservable,
        );
        time(
          "animations",
          scene.onBeforeAnimationsObservable,
          scene.onAfterAnimationsObservable,
        );
        time(
          "activeMeshes",
          scene.onBeforeActiveMeshesEvaluationObservable,
          scene.onAfterActiveMeshesEvaluationObservable,
        );
        time(
          "renderTargets",
          scene.onBeforeRenderTargetsRenderObservable,
          scene.onAfterRenderTargetsRenderObservable,
        );
        time(
          "drawPhase",
          scene.onBeforeDrawPhaseObservable,
          scene.onAfterDrawPhaseObservable,
        );
        time(
          "particles",
          scene.onBeforeParticlesRenderingObservable,
          scene.onAfterParticlesRenderingObservable,
        );
        const drawCalls: number[] = [];
        const counter = (
          engine as unknown as { _drawCalls?: { current: number } }
        )._drawCalls;
        const draws = scene.onAfterRenderObservable.add(() => {
          if (counter) drawCalls.push(counter.current);
        });
        const gaps: number[] = [];
        await new Promise<void>((resolve) => {
          let last = performance.now();
          const started = last;
          const frame = (now: number) => {
            gaps.push(now - last);
            last = now;
            if (now - started < 15_000) requestAnimationFrame(frame);
            else resolve();
          };
          requestAnimationFrame(frame);
        });
        for (const stop of timers) stop();
        scene.onAfterRenderObservable.remove(draws);
        const average = (values: number[]) =>
          values.length
            ? values.reduce((sum, value) => sum + value, 0) / values.length
            : 0;
        // Meshes grouped by the first name segment, to find the populous kinds.
        const census: Record<
          string,
          {
            total: number;
            active: number;
            instances: number;
            frozen: number;
            skinned: number;
          }
        > = {};
        const active = new Set(
          scene.getActiveMeshes().data.slice(0, scene.getActiveMeshes().length),
        );
        for (const mesh of scene.meshes) {
          const kind = mesh.name.split(/[-_:. 0-9]/)[0] || "(unnamed)";
          const entry = (census[kind] ??= {
            total: 0,
            active: 0,
            instances: 0,
            frozen: 0,
            skinned: 0,
          });
          entry.total += 1;
          entry.active += Number(active.has(mesh));
          entry.instances += Number(mesh.getClassName() === "InstancedMesh");
          entry.frozen += Number(mesh.isWorldMatrixFrozen);
          entry.skinned += Number(!!mesh.skeleton);
        }
        return {
          census,
          fps: 1000 / average(gaps),
          phases: Object.fromEntries(
            Object.entries(phases).map(([name, values]) => [
              name,
              Number(average(values).toFixed(2)),
            ]),
          ),
          drawCalls: average(drawCalls),
          meshes: scene.meshes.length,
          activeMeshes: scene.getActiveMeshes().length,
          activeIndices: scene.getActiveIndices(),
          materials: scene.materials.length,
          skeletons: scene.skeletons.length,
          animatables: scene.animatables.length,
          shadowMaps: scene.lights.filter((light) => light.getShadowGenerator())
            .length,
          particleSystems: scene.particleSystems.length,
        };
      }, variant);
      await mkdir(".checks", { recursive: true });
      await writeFile(
        `.checks/profile-${info.project.name}-${variant}.json`,
        `${JSON.stringify({ browser: info.project.name, variant, ...result })}\n`,
      );
    },
  );
