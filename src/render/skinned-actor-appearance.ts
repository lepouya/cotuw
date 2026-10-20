import { AnimationGroup, VertexBuffer } from "@babylonjs/core";

import { isOneOf } from "../simulation/validation";
import {
  ACTOR_TRIGGERS,
  POSE_ROLES,
  LAYERED_ROLES,
  mapClips,
  clipList,
  validateActorGraphics,
} from "../content/presentation";
import type { ActorGraphics, ClipRoles } from "../content/presentation";
import { createGaitState, stepGait } from "./actor-gait";
import {
  clipChannels,
  clipSeconds,
  findClip,
  findReturningClip,
  findTimedClip,
  instantiateContainer,
  loadContainer,
} from "./glb-model";

import type { AssetContainer, Scene } from "@babylonjs/core";
import type { ActorAppearance, ActorInstance } from "./actor";

type ClipGroups = ClipRoles<AnimationGroup>;

export type SkinnedActorOptions = {
  /**
   * Settles transitions, holds looping clips, skips triggered clips, and shows
   * death clips' last frame at once.
   */
  reducedMotion?: () => boolean;
};

/**
 * Loads a skinned model and its named clips from one GLB. Rejects a model
 * that lacks a skin or a clip, or whose clips animate nodes outside it.
 */
export async function loadSkinnedActorAppearance(
  scene: Scene,
  graphics: ActorGraphics,
  { reducedMotion = () => false }: SkinnedActorOptions = {},
): Promise<ActorAppearance> {
  validateActorGraphics(graphics);
  const { assets, prepared: clips } = await loadContainer(
    scene,
    graphics.url,
    (assets) => prepareClips(assets, graphics),
  );
  return {
    bounds: graphics.bounds,
    minimapColor: graphics.minimapColor,
    instantiate: (name, seed) => {
      const instance = instantiate(
        assets,
        clips,
        graphics.cycleDistance,
        reducedMotion,
        name,
        seed,
      );
      instance.root.scaling.setAll(graphics.scale ?? 1);
      return instance;
    },
    dispose: () => assets.dispose(),
  };
}

function prepareClips(
  assets: AssetContainer,
  { url, clips, rig }: ActorGraphics,
): ClipGroups {
  const invalid = (problem: string) =>
    new Error(`Actor model ${url} ${problem}`);
  if (!assets.meshes.some((mesh) => mesh.getTotalVertices() > 0))
    throw invalid("has no geometry");
  if (
    rig !== "rigid" &&
    !assets.meshes.some(
      (mesh) =>
        mesh.getTotalVertices() > 0 &&
        mesh.skeleton &&
        assets.skeletons.includes(mesh.skeleton) &&
        mesh.isVerticesDataPresent(VertexBuffer.MatricesIndicesKind) &&
        mesh.isVerticesDataPresent(VertexBuffer.MatricesWeightsKind),
    )
  ) {
    throw invalid("has no skin");
  }
  const groups = mapClips(clips, (name, role) => {
    if (role === "idle") return findClip(assets, name, invalid);
    return isOneOf(ACTOR_TRIGGERS, role)
      ? findReturningClip(assets, name, invalid)
      : findTimedClip(assets, name, invalid);
  });
  const idleChannels = clipChannels(groups.idle);
  const requirePose = (clip: AnimationGroup, exact: boolean) => {
    const keyed = clipChannels(clip);
    if (
      (exact && keyed.size !== idleChannels.size) ||
      [...idleChannels.keys()].some((channel) => !keyed.has(channel))
    )
      throw invalid(
        `clip ${clip.name} must key ${exact ? "the same" : "all idle"} pose channels`,
      );
  };
  for (const role of ["locomotion", ...POSE_ROLES] as const) {
    const clip = groups[role];
    if (clip) requirePose(clip, true);
  }
  if (groups.death) requirePose(groups.death, false);
  mapClips(groups, (clip, role) => {
    if (role !== "turn" && !isOneOf(LAYERED_ROLES, role)) return;
    if ([...clipChannels(clip)].some((channel) => !idleChannels.has(channel)))
      throw invalid(
        `clip ${clip.name} keys a channel that idle does not restore`,
      );
    AnimationGroup.MakeAnimationAdditive(clip, { referenceFrame: clip.from });
  });
  for (const each of assets.animationGroups) each.stop();
  return groups;
}

function instantiate(
  assets: AssetContainer,
  clips: ClipGroups,
  cycleDistance: number,
  reducedMotion: () => boolean,
  name: string,
  seed: number,
): ActorInstance {
  const used = clipList(clips);
  // Clones skeletons linked to the cloned joints and retargets the clips.
  const { root, entries, dispose } = instantiateContainer(assets, name, used);
  const sources = assets.animationGroups.filter((each) => used.includes(each));
  const groups = mapClips(
    clips,
    (source) => entries.animationGroups[sources.indexOf(source)]!,
  );
  const { idle, locomotion, turn, run, work, deploy, stow, aim, death } =
    groups;
  const indicators = (suffix: string) =>
    root.getChildMeshes().filter((node) => node.name.endsWith(suffix));
  const idleIndicators = indicators("idle-signal");
  const workIndicators = indicators("working-signal");
  for (const node of workIndicators) node.setEnabled(false);

  idle.start(true);
  idle.goToFrame(idle.from + seed * (idle.to - idle.from));
  idle.weight = 1;
  // Paused clips only blend on frames that seek them with their weight.
  const posed = clipList(groups).filter((group) => group !== idle);
  for (const group of posed) {
    group.start(true);
    group.pause();
    group.weight = 0;
  }
  const seek = (group: AnimationGroup, progress: number) => {
    if (group.weight > 0) {
      group.goToFrame(group.from + progress * (group.to - group.from), true);
    }
  };

  const gait = createGaitState();
  /** Seconds into each triggered clip that is playing. */
  const playing = new Map<AnimationGroup, number>();
  let deathProgress = 0;
  /** Undefined until the first state, which settles without a transition. */
  let working: boolean | undefined;
  /** How far the work pose is deployed, from 0 at idle to 1 at work. */
  let collector = 0;
  let aiming = false;
  let running = false;
  let dead = false;
  /** Seconds into the work loop, from when it takes over. */
  let workSeconds = 0;
  let still = false;
  return {
    root,
    setAnimationState: (state) => {
      if (dead) return;
      aiming = !!state.aiming;
      running = !!state.running;
      if (!work) return;
      const next = !!state.working;
      if (working === undefined) collector = next ? 1 : 0;
      working = next;
      for (const node of idleIndicators) node.setEnabled(!next);
      for (const node of workIndicators) node.setEnabled(next);
    },
    animate: (motion) => {
      if (dead) return;
      stepGait(gait, motion, cycleDistance);
      const reduced = reducedMotion();
      if (reduced) {
        idle.pause();
        idle.goToFrame(idle.from);
      } else if (still) idle.restart();
      still = reduced;
      const target = working ? 1 : 0;
      const transition = working ? deploy : stow;
      if (reduced || !transition) collector = target;
      else {
        const step = motion.seconds / clipSeconds(transition);
        collector = working
          ? Math.min(1, collector + step)
          : Math.max(0, collector - step);
      }
      const transitioning = collector !== target;
      const occupied = !!working || transitioning;
      idle.weight = occupied ? 0 : 1 - gait.locomotion;
      const stride = run && running ? run : locomotion;
      for (const group of [locomotion, run]) {
        if (!group) continue;
        group.weight = !occupied && group === stride ? gait.locomotion : 0;
        seek(group, reduced ? 0 : gait.cycle);
      }
      if (work) {
        // The loop starts from its first frame where deployment ends.
        workSeconds = work.weight ? workSeconds + motion.seconds : 0;
        work.weight = working && !transitioning ? 1 : 0;
        seek(work, reduced ? 0 : (workSeconds / clipSeconds(work)) % 1);
      }
      if (deploy && stow) {
        deploy.weight = transitioning && working ? 1 : 0;
        stow.weight = transitioning && !working ? 1 : 0;
        seek(deploy, collector);
        seek(stow, 1 - collector);
      }
      if (aim) {
        aim.weight = aiming ? 1 : 0;
        seek(aim, 1);
      }
      if (turn) {
        turn.left.weight = reduced ? 0 : Math.max(0, -gait.lean);
        turn.right.weight = reduced ? 0 : Math.max(0, gait.lean);
        seek(turn.left, 1);
        seek(turn.right, 1);
      }
      for (const [group, seconds] of playing) {
        if (reduced) {
          group.weight = 0;
          playing.delete(group);
          continue;
        }
        const elapsed = seconds + motion.seconds;
        const progress = elapsed / clipSeconds(group);
        group.weight = progress < 1 ? 1 : 0;
        if (progress < 1) {
          playing.set(group, elapsed);
          seek(group, progress);
        } else playing.delete(group);
      }
    },
    play: (trigger) => {
      const group = groups[trigger];
      // A repeated trigger restarts its clip.
      if (group && !dead && !reducedMotion()) {
        playing.set(group, 0);
        group.weight = 1;
        seek(group, 0);
      }
    },
    die:
      death &&
      ((seconds) => {
        dead = true;
        for (const node of [...idleIndicators, ...workIndicators])
          node.setEnabled(false);
        playing.clear();
        for (const group of [idle, ...posed]) {
          group.pause();
          group.weight = 0;
        }
        death.weight = 1;
        // A preference change must not stand fallen remains back up.
        deathProgress = Math.max(
          deathProgress,
          reducedMotion() ? 1 : Math.min(seconds / clipSeconds(death), 1),
        );
        seek(death, deathProgress);
      }),
    freeze: () => {
      for (const group of [idle, ...posed]) group.pause();
    },
    dispose,
  };
}
