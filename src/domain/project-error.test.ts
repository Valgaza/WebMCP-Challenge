import { describe, expect, it } from "vitest";
import { toProjectError } from "./project-error";

describe("ProjectError storage failures", () => {
  it("distinguishes quota exhaustion while preserving a safe recovery action", () => {
    const error = toProjectError(new DOMException("Storage is full", "QuotaExceededError"));
    expect(error).toMatchObject({
      code: "STORAGE_QUOTA_EXCEEDED",
      message: "Unable to save this project because browser storage is full. Free some storage and try again.",
    });
  });

  it("distinguishes blocked browser storage", () => {
    const error = toProjectError(new DOMException("Storage is blocked", "SecurityError"));
    expect(error).toMatchObject({
      code: "STORAGE_UNAVAILABLE",
      message: "Local project storage is blocked in this browser. Allow site storage and try again.",
    });
  });
});
