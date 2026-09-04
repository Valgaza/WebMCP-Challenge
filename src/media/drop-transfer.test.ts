import { describe, expect, it } from "vitest";
import { readDroppedFiles } from "./drop-transfer";

/**
 * A stub that behaves like the real thing, including the part that broke this.
 *
 * `getAsFile()` returns null once the item list has been neutered, and the browser neuters it
 * when the handler yields — not when any particular method is called. So the stub goes dead in
 * a microtask, which is the first thing that happens after an `await`. Code that reads every
 * file synchronously gets all of them; code that awaits mid-loop gets the first one only.
 */
function droppedItem(file: File, handle: FileSystemFileHandle | null, live: { current: boolean }): DataTransferItem {
  return {
    kind: "file",
    type: file.type,
    getAsFile: () => (live.current ? file : null),
    getAsFileSystemHandle: async () => handle,
  } as unknown as DataTransferItem;
}

/** Hands control back to the event loop once, exactly as dispatching the drop event does. */
function afterDispatch(live: { current: boolean }): void {
  queueMicrotask(() => { live.current = false; });
}

function handleFor(file: File): FileSystemFileHandle {
  return { kind: "file", name: file.name, getFile: async () => file } as unknown as FileSystemFileHandle;
}

describe("readDroppedFiles", () => {
  it("reads every file before the item list is neutered", async () => {
    const live = { current: true };
    const first = new File(["a"], "one.png", { type: "image/png" });
    const second = new File(["b"], "two.png", { type: "image/png" });

    const items = [droppedItem(first, handleFor(first), live), droppedItem(second, handleFor(second), live)];
    afterDispatch(live);
    const result = await readDroppedFiles(items);

    // Reading the handle first cost every file after the first one.
    expect(result.files.map((file) => file.name)).toEqual(["one.png", "two.png"]);
    expect(result.handles).toHaveLength(2);
  });

  it("keeps the files when the browser offers no handles", async () => {
    const live = { current: true };
    const file = new File(["a"], "one.png", { type: "image/png" });
    const item = { kind: "file", type: file.type, getAsFile: () => (live.current ? file : null) } as unknown as DataTransferItem;
    afterDispatch(live);

    const result = await readDroppedFiles([item]);

    expect(result.files.map((entry) => entry.name)).toEqual(["one.png"]);
    expect(result.handles).toEqual([]);
  });

  it("drops the handles rather than mispairing them when only some files have one", async () => {
    const live = { current: true };
    const withHandle = new File(["a"], "one.png", { type: "image/png" });
    const without = new File(["b"], "two.png", { type: "image/png" });

    const items = [droppedItem(withHandle, handleFor(withHandle), live), droppedItem(without, null, live)];
    afterDispatch(live);
    const result = await readDroppedFiles(items);

    expect(result.files).toHaveLength(2);
    expect(result.handles).toEqual([]);
  });

  it("ignores anything dropped that is not a file", async () => {
    const text = { kind: "string", type: "text/plain", getAsFile: () => null } as unknown as DataTransferItem;
    await expect(readDroppedFiles([text])).resolves.toEqual({ files: [], handles: [] });
  });
});
