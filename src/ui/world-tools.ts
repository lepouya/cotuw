type Tool = "placement" | "attackMove" | "rally";
export type WorldTools = ReturnType<typeof createWorldTools>;

/** Owns the tool that can claim the next world target. */
export function createWorldTools() {
  let current: { tool: Tool; cancel: () => void } | undefined;
  const cancel = () => {
    if (!current) return false;
    current.cancel();
    return current === undefined;
  };
  return {
    get active() {
      return current?.tool;
    },
    /** A pending placement can refuse cancellation until its order resolves. */
    activate(tool: Tool, cancelTool: () => void) {
      if (current && current.tool !== tool && !cancel()) return false;
      current = { tool, cancel: cancelTool };
      return true;
    },
    cancel,
    end(tool: Tool) {
      if (current?.tool === tool) current = undefined;
    },
  };
}
