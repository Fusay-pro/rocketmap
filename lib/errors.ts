/**
 * Turn an unknown caught value into a message that is always worth showing.
 *
 * The idiom this replaces — `error instanceof Error ? error.message : String(error)`
 * — has two failure modes that both surface to the client as nothing at all:
 *
 *   - `error.message` is `""` or `undefined` (some SDK error subclasses do this).
 *     `NextResponse.json({ error: undefined })` serialises to `{}`, so the caller
 *     logs "error response: {}" and has no idea what happened.
 *   - the thrown value is a plain object, and `String(error)` gives "[object Object]".
 *
 * Guarantees a non-empty string for every input.
 */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // `message` can be "" or undefined despite the type saying otherwise.
    if (error.message) return error.message;
    // A subclass inherits name === "Error" unless it sets one, so prefer the
    // constructor name when `name` is the generic default. For an AI SDK
    // APICallError with an empty message that is the difference between
    // reporting "APICallError" and reporting "Error".
    const ctor = error.constructor?.name;
    if ((!error.name || error.name === "Error") && ctor && ctor !== "Object") {
      return ctor;
    }
    return error.name || "Unknown error";
  }

  if (typeof error === "string") {
    return error || "Unknown error";
  }

  if (error === null || error === undefined) {
    return "Unknown error";
  }

  if (typeof error === "object") {
    try {
      const json = JSON.stringify(error);
      // JSON.stringify returns undefined for some values, "{}" for empties.
      return json && json !== "{}" && json !== "[]" ? json : "Unknown error";
    } catch {
      // Circular structures, BigInt, throwing toJSON.
      return "Unknown error";
    }
  }

  return String(error) || "Unknown error";
}
