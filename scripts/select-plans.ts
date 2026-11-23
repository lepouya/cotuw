/** The plans named on the command line, or every plan when none are named. */
export function selectPlans<Plan extends { readonly id: string }>(
  ids: readonly string[],
  plans: readonly Plan[],
  usage: string,
): readonly Plan[] {
  if (!ids.length) return plans;
  return ids.map((id) => {
    const plan = plans.find((candidate) => candidate.id === id);
    if (!plan)
      throw new Error(
        `Unknown plan "${id}".\n${usage}\n` +
          `Plans: ${plans.map((candidate) => candidate.id).join(", ")}.`,
      );
    return plan;
  });
}
