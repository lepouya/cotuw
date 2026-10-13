// Texture clips that play briefly on actors, such as muzzle flashes. Playback
// reads real time and never feeds simulation state.
import {
  Constants,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Texture,
  TransformNode,
} from "@babylonjs/core";

import { compileTextureClip } from "../content/texture-clip";
import { hasOwn, isId, isPositive, isRecord } from "../simulation/validation";
import { ACTOR_TRIGGERS } from "./actor";
import { loadClipFrames } from "./texture-clip";

import type { Scene } from "@babylonjs/core";
import type { TextureClip } from "../content/texture-clip";
import type { ActorAppearance, ActorTrigger } from "./actor";
import type { ClipFrames } from "./texture-clip";

/** A content pack clip shown once on a camera-facing square. */
export type FrameEffect = {
  clip: string;
  /** The clip's sprite sheet. */
  url: string;
  /** Edge length in world units. */
  size: number;
  /** In the actor's model space: from its ground point, facing +Z. */
  anchor: [number, number, number];
};

export type FrameEffects = Partial<Record<ActorTrigger, FrameEffect>>;

/** Throws unless each effect names a trigger, a known clip, and a placement. */
export function validateFrameEffects(
  actorId: string,
  effects: unknown,
  clips: Readonly<Record<string, unknown>>,
): asserts effects is FrameEffects {
  if (!isRecord(effects))
    throw new RangeError(`Frame effects for ${actorId} are invalid.`);
  for (const [trigger, effect] of Object.entries(effects))
    if (
      !ACTOR_TRIGGERS.includes(trigger as ActorTrigger) ||
      !isRecord(effect) ||
      !isId(effect.clip) ||
      !hasOwn(clips, effect.clip) ||
      !isId(effect.url) ||
      !isPositive(effect.size) ||
      !Array.isArray(effect.anchor) ||
      effect.anchor.length !== 3 ||
      !effect.anchor.every(Number.isFinite)
    )
      throw new RangeError(
        `The ${trigger} frame effect for ${actorId} is invalid.`,
      );
}

export type FrameEffectsView = ReturnType<typeof createFrameEffectsView>;

/**
 * Wraps an appearance so each instance also plays `effects` on its model
 * when triggered.
 */
export function withFrameEffects(
  appearance: ActorAppearance,
  effects: FrameEffects,
  view: Pick<FrameEffectsView, "play">,
): ActorAppearance {
  return {
    ...appearance,
    instantiate: (name, seed) => {
      const instance = appearance.instantiate(name, seed);
      return {
        ...instance,
        play: (trigger) => {
          instance.play?.(trigger);
          const effect = effects[trigger];
          if (effect) view.play(effect, instance.root);
        },
      };
    },
  };
}

type Source = {
  clip: TextureClip;
  frames: ClipFrames;
  frameAt: (seconds: number) => number;
  duration: number;
  /** Glowing materials by sheet cell, made once the cell loads. */
  materials: Map<number, StandardMaterial>;
};

/**
 * Plays frame effects on actor nodes. Each lasts one cycle of its clip;
 * reduced motion holds the first frame for that time.
 */
export function createFrameEffectsView(
  scene: Scene,
  clips: Readonly<Record<string, TextureClip>>,
  reducedMotion: () => boolean,
) {
  const sources = new Map<string, Source>();
  let disposed = false;
  const active: {
    anchor: TransformNode;
    mesh: Mesh;
    source: Source;
    seconds: number;
  }[] = [];
  const sourceFor = ({ clip: id, url }: FrameEffect): Source => {
    const key = JSON.stringify([id, url]);
    let source = sources.get(key);
    if (!source) {
      const clip = clips[id]!;
      const { frameAt, duration } = compileTextureClip(clip);
      source = {
        clip,
        frameAt,
        duration,
        frames: loadClipFrames(scene, url, clip, (texture) => {
          texture.hasAlpha = true;
          texture.wrapU = Texture.CLAMP_ADDRESSMODE;
          texture.wrapV = Texture.CLAMP_ADDRESSMODE;
        }),
        materials: new Map(),
      };
      sources.set(key, source);
    }
    return source;
  };
  const materialFor = (source: Source, cell: number) => {
    let material = source.materials.get(cell);
    const texture = source.frames.frames.get(cell);
    if (!material && texture) {
      material = new StandardMaterial(`frame-effect-${texture.name}`, scene);
      material.emissiveTexture = texture;
      material.opacityTexture = texture;
      material.disableLighting = true;
      material.backFaceCulling = false;
      material.alphaMode = Constants.ALPHA_ADD;
      source.materials.set(cell, material);
    }
    return material;
  };
  const show = (effect: (typeof active)[number]) => {
    const { source, mesh, anchor, seconds } = effect;
    anchor.computeWorldMatrix(true);
    // Anchors follow model scale; the square's size is in world units.
    const scale = anchor.absoluteScaling;
    mesh.scaling.set(1 / scale.x, 1 / scale.y, 1 / scale.z);
    const frame = source.frameAt(reducedMotion() ? 0 : seconds);
    const material = materialFor(source, source.clip.frames[frame]!.cell);
    mesh.isVisible = !!material;
    if (material) mesh.material = material;
  };
  return {
    /** Loads sheets before a short effect needs to be shown. */
    prepare: (effects: FrameEffects) => {
      if (disposed) return;
      for (const effect of Object.values(effects))
        if (effect) sourceFor(effect);
    },
    /** Starts `effect` in `node`'s space, following it until either ends. */
    play: (effect: FrameEffect, node: TransformNode) => {
      if (disposed || node.isDisposed()) return;
      const source = sourceFor(effect);
      // A billboard ignores its parent's rotation, so a plain node carries the
      // anchor round with the actor's facing.
      const anchor = new TransformNode("frame-effect-anchor", scene);
      anchor.parent = node;
      anchor.position.set(...effect.anchor);
      const mesh = MeshBuilder.CreatePlane(
        "frame-effect",
        { size: effect.size },
        scene,
      );
      mesh.parent = anchor;
      mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
      mesh.isPickable = false;
      mesh.renderingGroupId = 1;
      const playing = { anchor, mesh, source, seconds: 0 };
      active.push(playing);
      show(playing);
    },
    /** Advances effects by real, not simulated, time. */
    update: (seconds: number) => {
      for (let index = active.length - 1; index >= 0; index -= 1) {
        const effect = active[index]!;
        effect.seconds += seconds;
        if (
          effect.anchor.isDisposed() ||
          effect.seconds >= effect.source.duration
        ) {
          effect.anchor.dispose();
          active.splice(index, 1);
        } else show(effect);
      }
    },
    dispose: () => {
      disposed = true;
      for (const { anchor } of active) anchor.dispose();
      active.length = 0;
      for (const { frames, materials } of sources.values()) {
        for (const material of materials.values()) material.dispose();
        frames.dispose();
      }
      sources.clear();
    },
  };
}
