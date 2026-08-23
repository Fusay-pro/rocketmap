import { describe, it, expect } from "vitest";
import { toErrorMessage } from "@/lib/errors";

describe("toErrorMessage", () => {
  it("uses the message of a normal Error", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("falls back to the error name when the message is empty", () => {
    // The bug this helper exists for: `error.message` on some SDK error
    // subclasses is "" or undefined, and `{ error: undefined }` serialises
    // to `{}` — the client then reports an error with no information at all.
    expect(toErrorMessage(new Error(""))).toBe("Error");
  });

  it("keeps the subclass name when the message is empty", () => {
    class ApiCallError extends Error {}
    expect(toErrorMessage(new ApiCallError(""))).toBe("ApiCallError");
  });

  it("survives an Error whose message is undefined", () => {
    const err = new Error("x");
    (err as { message?: string }).message = undefined;
    expect(toErrorMessage(err)).toBe("Error");
  });

  it("handles plain strings", () => {
    expect(toErrorMessage("just a string")).toBe("just a string");
  });

  it("serialises plain objects rather than yielding [object Object]", () => {
    expect(toErrorMessage({ code: 429, detail: "slow down" })).toBe(
      '{"code":429,"detail":"slow down"}',
    );
  });

  it("handles objects that cannot be serialised", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(toErrorMessage(circular)).toBe("Unknown error");
  });

  it("never returns an empty string", () => {
    for (const input of [null, undefined, "", 0, false, {}, []]) {
      expect(toErrorMessage(input).length).toBeGreaterThan(0);
    }
  });
});
