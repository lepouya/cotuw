import type { TransformNode } from "@babylonjs/core";

/**
 * Freezes or thaws a static hierarchy's world matrices, so frames skip
 * recomputing them. Thaw before moving any part, then freeze again.
 */
export function setTransformsFrozen(root: TransformNode, frozen: boolean) {
  for (const node of [root, ...root.getChildTransformNodes()])
    if (frozen) node.freezeWorldMatrix();
    else node.unfreezeWorldMatrix();
}

/** Thaws a frozen hierarchy for `change`, then freezes it again. */
export function changeFrozen(root: TransformNode, change: () => void) {
  setTransformsFrozen(root, false);
  try {
    change();
  } finally {
    setTransformsFrozen(root, true);
  }
}
