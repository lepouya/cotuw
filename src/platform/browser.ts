import type { Platform } from ".";

const PREFIX = "cotuw.save.";

/** Keeps saves in local storage and exchanges files through downloads. */
export function createBrowserPlatform(): Platform {
  const storage = () => {
    try {
      return localStorage;
    } catch {
      throw new Error("This browser blocks saved games for this page.");
    }
  };
  return {
    saves: {
      list: async () =>
        Object.keys(storage())
          .filter((key) => key.startsWith(PREFIX))
          .map((key) => key.slice(PREFIX.length)),
      read: async (id) => {
        const source = storage().getItem(PREFIX + id);
        if (source === null) throw new Error("This save no longer exists.");
        return source;
      },
      write: async (id, source) => {
        const target = storage();
        try {
          target.setItem(PREFIX + id, source);
        } catch (error) {
          throw new Error(
            error instanceof DOMException && error.name === "QuotaExceededError"
              ? "Browser storage is full. Delete or export saves to make room."
              : "This browser blocks saved games for this page.",
          );
        }
      },
      remove: async (id) => storage().removeItem(PREFIX + id),
    },
    exportFile: async (name, source) => {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(
        new Blob([source], { type: "application/json" }),
      );
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href));
      return true;
    },
    importFile: () =>
      new Promise((resolve, reject) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.addEventListener("change", () => {
          const file = input.files?.[0];
          if (file) file.text().then(resolve, reject);
          else resolve(undefined);
        });
        input.addEventListener("cancel", () => resolve(undefined));
        input.click();
      }),
  };
}
