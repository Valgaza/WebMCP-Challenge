import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";

/**
 * The interface tests wait on real work: a document is created in IndexedDB and the editor
 * re-renders from it. Alone that is well under the one-second default, but the suite runs its
 * files in parallel and under that contention the wait crosses it — a timing flake, not a
 * failure. Five seconds is far above what any of these take and still catches a query that
 * will never resolve.
 */
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => {
  cleanup();
});

Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
  configurable: true,
  value(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  },
});

Object.defineProperty(HTMLDialogElement.prototype, "close", {
  configurable: true,
  value(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  },
});

Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
  configurable: true,
  value() {},
});

Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
  configurable: true,
  value() {},
});
