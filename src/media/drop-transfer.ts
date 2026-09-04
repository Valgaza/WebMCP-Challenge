/**
 * Reads everything a drop carries before the browser takes it away.
 *
 * A `DataTransferItem` is only valid while the drop event is being dispatched. The moment the
 * handler awaits anything, the list is neutered and `getAsFile()` starts returning null — so
 * the order of these two calls is the whole correctness of the operation, and getting it wrong
 * fails silently: no files, no error, no job, a drop that simply does nothing.
 *
 * So every synchronous read happens in one pass over the live list, and only promises are
 * awaited afterwards.
 */
export interface DroppedTransfer {
  files: File[];
  /** Present only when every file came with one, since imports pair them by index. */
  handles: FileSystemFileHandle[];
}

type HandleBearingItem = DataTransferItem & {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
};

export async function readDroppedFiles(items: Iterable<DataTransferItem>): Promise<DroppedTransfer> {
  const pending = [...items]
    .filter((item) => item.kind === "file")
    .map((item) => ({
      file: item.getAsFile(),
      handle: (item as HandleBearingItem).getAsFileSystemHandle?.().catch(() => null) ?? Promise.resolve(null),
    }))
    .filter((entry): entry is { file: File; handle: Promise<FileSystemHandle | null> } => entry.file !== null);

  const settled = await Promise.all(pending.map((entry) => entry.handle));
  const files = pending.map((entry) => entry.file);
  const handles = settled.filter((handle): handle is FileSystemFileHandle => handle?.kind === "file");

  return { files, handles: handles.length === files.length ? handles : [] };
}
