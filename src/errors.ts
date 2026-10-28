/** The message of a thrown value, whether or not it is an `Error`. */
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
