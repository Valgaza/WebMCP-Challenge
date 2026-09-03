import { beforeEach, describe, expect, it, vi } from "vitest";
import { focusStore } from "./focus-store";

describe("focusStore", () => {
  beforeEach(() => focusStore.reset());

  it("delivers to listeners that are already attached", () => {
    const listener = vi.fn();
    const stop = focusStore.subscribe(listener);
    focusStore.request("project-1", "inspector", "webmcp");
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  /**
   * An agent can call focus_ui while the editor is still mounting. Dropping the request there
   * made focus silently fail, and made the workspace focus test intermittently flaky.
   */
  it("holds a request made before anything is listening and replays it on subscribe", async () => {
    const request = focusStore.request("project-1", "inspector-document-width", "webmcp");
    const listener = vi.fn();
    focusStore.subscribe(listener);

    await Promise.resolve();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ id: request.id, targetId: "inspector-document-width" }));
  });

  it("replays a held request only once", async () => {
    focusStore.request("project-1", "inspector", "webmcp");
    const first = vi.fn();
    const second = vi.fn();
    focusStore.subscribe(first);
    focusStore.subscribe(second);

    await Promise.resolve();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("discards a held request that is too old to still be meaningful", async () => {
    vi.useFakeTimers();
    try {
      focusStore.request("project-1", "inspector", "webmcp");
      vi.advanceTimersByTime(5000);
      const listener = vi.fn();
      focusStore.subscribe(listener);
      await Promise.resolve();
      expect(listener).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
