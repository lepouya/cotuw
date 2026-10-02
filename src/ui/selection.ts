/** Buildings stay individual; additive and box selection contain mobile units. */
export function createSelection(isMobile: (id: string) => boolean) {
  let ids: readonly string[] = [];
  const replace = (next: Iterable<string>) => {
    ids = Object.freeze([...new Set(next)].sort());
  };
  return {
    get ids() {
      return ids;
    },
    select: (id: string | undefined, additive = false) => {
      if (!id) replace([]);
      else if (!additive || !isMobile(id)) replace([id]);
      else {
        const next = new Set(ids.filter(isMobile));
        if (next.has(id)) next.delete(id);
        else next.add(id);
        replace(next);
      }
    },
    selectMany: (next: readonly string[], additive = false) =>
      replace([
        ...(additive ? ids.filter(isMobile) : []),
        ...next.filter(isMobile),
      ]),
    retain: (exists: (id: string) => boolean) => replace(ids.filter(exists)),
  };
}
