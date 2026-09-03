import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  AlertTriangle, ArrowDownUp, Clapperboard, Film, FolderPlus, FolderTree, Image as ImageIcon,
  ImagePlus, LayoutGrid, Link2, List, Music, Repeat, Scissors, Search, SlidersHorizontal,
  Sparkles, Trash2, Upload, X,
} from "lucide-react";
import type { AssetRecord, AssetSearch, ParsedAssetSearch } from "../domain/asset";
import {
  MEDIA_FILE_EXTENSIONS, describeDurability, hasProxy,
} from "../domain/asset";
import type { AssetSearchResult, AssetService } from "../application/asset-service";
import type { OrganizationService, OrganizationSnapshot } from "../application/organization-service";
import type { Bin, BinItemType } from "../domain/organization";
import { formatBytes } from "../data/storage-quota";
import { describePresence } from "../media/container-probe";
import { ProjectError } from "../domain/project-error";
import type { CatalogueService } from "../application/catalogue-service";
import { MarkingPanel } from "./MarkingPanel";
import { count } from "../domain/plural";

export type MediaView = "grid" | "list" | "bins" | "storyboard";

interface MediaLibraryPanelProps {
  projectId: string;
  assetService: AssetService;
  organizationService?: OrganizationService;
  catalogueService?: CatalogueService;
  revisionKey: string;
  view: MediaView;
  activeBinId: string | null;
  /** Set when the project can take a photo layer, so "Add to canvas" is offered honestly. */
  canAddToCanvas: boolean;
  selectedAssetId: string | null;
  onSelectAsset: (assetId: string | null) => void;
  onChangeView: (view: MediaView, binId: string | null) => void;
  onAddToCanvas: (assetId: string) => void;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
  agentTarget?: string | null;
}

/**
 * Photographs only.
 *
 * The asset model still understands video and audio, because probing them is how a file that
 * is not a photograph gets a clear answer rather than a decode failure. Offering them in the
 * picker is a different thing: it invites an import that this product has nothing to do with.
 */
const ACCEPT = [...MEDIA_FILE_EXTENSIONS.image].join(",");

const KIND_ICON = { image: ImageIcon, video: Film, audio: Music } as const;

const SORT_OPTIONS: { value: ParsedAssetSearch["sortBy"]; label: string }[] = [
  { value: "addedAt", label: "Date added" },
  { value: "name", label: "Name" },
  { value: "byteSize", label: "File size" },
  { value: "pixels", label: "Resolution" },
  { value: "duration", label: "Duration" },
];

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

/**
 * The project's media, however the user wants to look at it.
 *
 * A browser only grants file access from a user gesture, so import lives here rather than in
 * a WebMCP tool. Everything an agent can do afterwards — inspect, filter, organize, relink,
 * replace, place — is reachable from both paths and runs through the same services.
 */
export function MediaLibraryPanel({
  projectId, assetService, organizationService, catalogueService, revisionKey,
  view, activeBinId, canAddToCanvas, selectedAssetId, onSelectAsset, onChangeView,
  onAddToCanvas,
  onStatus, onError, agentTarget,
}: MediaLibraryPanelProps) {
  const [result, setResult] = useState<AssetSearchResult>({ records: [], totalCount: 0, matchedCount: 0, activeFilters: [], matches: {} });
  const [organization, setOrganization] = useState<OrganizationSnapshot>({ bins: [], items: [], subclips: [], sourceMarkers: [] });
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [kinds, setKinds] = useState<("image" | "video" | "audio")[]>([]);
  const [availability, setAvailability] = useState<AssetRecord["availability"][]>([]);
  const [proxyState, setProxyState] = useState<"any" | "present" | "absent">("any");
  const [sortBy, setSortBy] = useState<ParsedAssetSearch["sortBy"]>("addedAt");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [replacement, setReplacement] = useState<Awaited<ReturnType<AssetService["proposeReplacement"]>> | null>(null);
  const [storage, setStorage] = useState<Awaited<ReturnType<AssetService["storageReport"]>> | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const relinkRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const relinkTargetRef = useRef<string | null>(null);
  const pendingReplacementFile = useRef<File | null>(null);

  const search = useMemo<AssetSearch>(() => ({
    query, kinds, availability, proxyState, sortBy, direction,
    binId: view === "bins" ? activeBinId : null,
    limit: 300,
  }), [query, kinds, availability, proxyState, sortBy, direction, view, activeBinId]);

  const refresh = useCallback(async () => {
    setResult(await assetService.searchAssets(projectId, search));
    if (organizationService) setOrganization(await organizationService.getOrganization(projectId));
    setStorage(await assetService.storageReport(projectId).catch(() => null));
  }, [assetService, organizationService, projectId, search]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => assetService.subscribe(projectId, () => { void refresh(); }), [assetService, projectId, refresh]);

  // Availability is re-checked on open because a file can disappear between sessions.
  useEffect(() => {
    void assetService.refreshAvailability(projectId).then((changed) => {
      if (changed.length) onStatus(`${changed.length} media source${changed.length === 1 ? "" : "s"} changed availability.`);
    }).catch(() => undefined);
  }, [assetService, projectId, onStatus]);

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    void (async () => {
      const next: Record<string, string> = {};
      for (const asset of result.records) {
        if (!asset.thumbnailCacheKey) continue;
        const blob = await assetService.readDerived(asset.thumbnailCacheKey).catch(() => null);
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        created.push(url);
        next[asset.id] = url;
      }
      if (!cancelled) setThumbnails(next);
    })();
    return () => {
      cancelled = true;
      created.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [result.records, assetService]);

  const selected = useMemo(() => result.records.find((asset) => asset.id === selectedAssetId) ?? null, [result.records, selectedAssetId]);
  const offlineCount = result.records.filter((asset) => asset.availability !== "available").length;
  const unsupportedCount = result.records.filter((asset) => asset.editability === "unsupported").length;
  const supportsFolders = typeof window.showDirectoryPicker === "function";
  const filtersActive = result.activeFilters.length > 0;

  async function importFiles(files: File[], handles: FileSystemFileHandle[] = []) {
    if (!files.length) return;
    setBusy("import");
    try {
      const requests = files.map((file, index) => ({ file, handle: handles[index] ?? null }));
      const { jobId } = await assetService.startImportJob(projectId, requests, { intent: "Import media through the media library." });
      onStatus(`Importing ${files.length} file${files.length === 1 ? "" : "s"}.`);
      const finished = await assetService.waitForImport(jobId);
      if (finished.warnings.length) {
        onStatus(`Imported ${finished.outputIds.length} file(s) with ${finished.warnings.length} note(s). ${finished.warnings[0]}`);
      } else {
        onStatus(`Imported ${finished.outputIds.length} file${finished.outputIds.length === 1 ? "" : "s"}.`);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "The import did not complete.");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Both paths copy the file into private storage. The picker additionally yields a handle,
   * which reflects later edits to the file on disk, but the copy is what makes the import
   * survive a reload without asking for permission again.
   */
  async function chooseFiles() {
    const picker = window.showOpenFilePicker;
    if (!picker) { inputRef.current?.click(); return; }
    try {
      const handles = await picker({
        multiple: true,
        types: [
          { description: "Images", accept: { "image/*": MEDIA_FILE_EXTENSIONS.image as never } },
        ],
      });
      const files = await Promise.all(handles.map((handle) => handle.getFile()));
      await importFiles(files, handles);
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") return;
      inputRef.current?.click();
    }
  }

  async function chooseFolder() {
    const picker = window.showDirectoryPicker;
    if (!picker) { onError("This browser cannot import a whole folder. Choose individual files instead."); return; }
    setBusy("folder");
    try {
      const directory = await picker({ mode: "read" });
      const { jobId } = await assetService.startFolderImportJob(projectId, directory, { intent: "Import a folder of media." });
      onStatus(`Scanning “${directory.name}”.`);
      const finished = await assetService.waitForImport(jobId);
      onStatus(finished.warnings.length
        ? `Imported ${finished.outputIds.length} file(s) with ${finished.warnings.length} skipped.`
        : `Imported ${finished.outputIds.length} file(s) from “${directory.name}”.`);
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") return;
      onError(error instanceof Error ? error.message : "The folder import did not complete.");
    } finally {
      setBusy(null);
    }
  }

  async function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const items = [...event.dataTransfer.items].filter((item) => item.kind === "file");
    const handles: FileSystemFileHandle[] = [];
    const files: File[] = [];
    for (const item of items) {
      const maybeHandle = await (item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> })
        .getAsFileSystemHandle?.().catch(() => null);
      const file = item.getAsFile();
      if (!file) continue;
      files.push(file);
      if (maybeHandle && maybeHandle.kind === "file") handles.push(maybeHandle as FileSystemFileHandle);
    }
    await importFiles(files, handles.length === files.length ? handles : []);
  }

  async function relink(assetId: string) {
    relinkTargetRef.current = assetId;
    const picker = window.showOpenFilePicker;
    if (!picker) { relinkRef.current?.click(); return; }
    try {
      const [handle] = await picker({ multiple: false });
      const outcome = await assetService.relinkAsset(assetId, { file: await handle.getFile(), handle }, { intent: "Relink a media source." });
      onStatus(outcome.losses.length
        ? `Relinked and kept every edit. ${outcome.losses[0]}`
        : `Relinked. ${describeDurability({ locatorType: outcome.durability, fileName: "" } as never)}`);
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") return;
      relinkRef.current?.click();
    }
  }

  /** Replacement shows its consequences first, because it changes every edit that uses it. */
  async function proposeReplace(assetId: string) {
    relinkTargetRef.current = assetId;
    replaceRef.current?.click();
  }

  async function confirmReplace() {
    const file = pendingReplacementFile.current;
    const assetId = relinkTargetRef.current;
    if (!file || !assetId) return;
    setBusy("replace");
    try {
      const outcome = await assetService.relinkAsset(assetId, { file, handle: null }, { intent: "Replace a media source after review." });
      onStatus(`Replaced the source. ${outcome.invalidatedDerivatives.length} generated preview(s) were rebuilt.`);
      setReplacement(null);
      pendingReplacementFile.current = null;
    } catch (error) {
      onError(error instanceof Error ? error.message : "The replacement did not complete.");
    } finally {
      setBusy(null);
    }
  }

  async function generateProxy(assetId: string) {
    try {
      await assetService.startProxyJob(assetId, "balanced");
      onStatus("Building an optimized copy for responsive preview. Watch the Job Center for progress.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "The proxy job did not start.");
    }
  }

  async function remove(assetId: string) {
    try {
      const result = await assetService.removeAsset(assetId, { intent: "Remove media from the library." });
      onSelectAsset(null);
      onStatus(`${result.transaction.summary} Undo is available.`);
    } catch (error) {
      onError(error instanceof Error ? error.message : "The media was not removed.");
    }
  }

  async function createBin() {
    if (!organizationService) return;
    try {
      const outcome = await organizationService.apply(projectId, {
        operation: "create_bin", name: `Bin ${organization.bins.length + 1}`, parentBinId: activeBinId,
      }, { intent: "Create a bin from the Media panel." });
      onStatus(outcome.transaction.summary);
    } catch (error) {
      onError(error instanceof ProjectError ? error.message : "The bin was not created.");
    }
  }

  async function moveIntoBin(itemType: BinItemType, itemId: string, binId: string | null) {
    if (!organizationService) return;
    try {
      const outcome = await organizationService.apply(projectId, {
        operation: "move_items", items: [{ itemType, itemId }], binId,
      }, { intent: "Organize media into a bin." });
      onStatus(outcome.transaction.summary);
    } catch (error) {
      onError(error instanceof ProjectError ? error.message : "That item was not moved.");
    }
  }


  function toggleKind(kind: "image" | "video" | "audio") {
    setKinds((current) => current.includes(kind) ? current.filter((entry) => entry !== kind) : [...current, kind]);
  }

  function clearFilters() {
    setQuery("");
    setKinds([]);
    setAvailability([]);
    setProxyState("any");
    onChangeView(view, null);
  }

  const binChildren = (parentId: string | null): Bin[] => organization.bins.filter((bin) => bin.parentBinId === parentId);

  function renderBinTree(parentId: string | null, depth = 0) {
    const children = binChildren(parentId);
    if (!children.length) return null;
    return (
      <ul className="bin-tree" role="group">
        {children.map((bin) => (
          <li key={bin.id}>
            <button
              type="button"
              className={`bin-tree__item${activeBinId === bin.id ? " bin-tree__item--active" : ""}`}
              style={{ paddingInlineStart: `${8 + depth * 14}px` }}
              aria-pressed={activeBinId === bin.id}
              onClick={() => onChangeView("bins", bin.id)}
            >
              <FolderTree aria-hidden="true" size={14} />
              <span>{bin.name}</span>
              <small>{organization.items.filter((item) => item.binId === bin.id).length}</small>
            </button>
            {renderBinTree(bin.id, depth + 1)}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div id="media-tabpanel" role="tabpanel" aria-labelledby="media-tab" className="media-panel" data-semantic-id="panel-media" data-agent-target={agentTarget === "panel-media" ? "true" : undefined}>
      <div className="panel-heading">
        <h2>Media</h2>
        <span>{result.matchedCount}{result.matchedCount !== result.totalCount ? ` / ${result.totalCount}` : ""}</span>
      </div>

      <div className="media-search" data-semantic-id="media-search">
        <Search aria-hidden="true" size={14} />
        <input
          type="search" value={query}
          aria-label="Search media by name, format, tag, or folder"
          placeholder="Search media"
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          type="button" className="icon-button icon-button--tight"
          data-semantic-id="media-filters"
          data-agent-target={agentTarget === "media-filters" ? "true" : undefined}
          aria-label="Filter media" aria-expanded={filtersOpen} aria-pressed={filtersActive}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <SlidersHorizontal aria-hidden="true" size={15} />
        </button>
      </div>

      {filtersOpen ? (
        <div className="media-filters" aria-label="Media filters">
          <fieldset>
            <legend>Kind</legend>
            <div className="chip-row">
              {(["image", "video", "audio"] as const).map((kind) => (
                <button
                  key={kind} type="button" className="chip" aria-pressed={kinds.includes(kind)}
                  onClick={() => toggleKind(kind)}
                >
                  {kind}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Availability</legend>
            <div className="chip-row">
              {(["available", "missing", "permission_required", "unsupported"] as const).map((state) => (
                <button
                  key={state} type="button" className="chip" aria-pressed={availability.includes(state)}
                  onClick={() => setAvailability((current) => current.includes(state) ? current.filter((entry) => entry !== state) : [...current, state])}
                >
                  {state.replace("_", " ")}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="slider-field">
            <span>Proxy</span>
            <select value={proxyState} onChange={(event) => setProxyState(event.target.value as typeof proxyState)}>
              <option value="any">Any</option>
              <option value="present">Has a proxy</option>
              <option value="absent">No proxy</option>
            </select>
          </label>
          <label className="slider-field" data-semantic-id="media-sort">
            <span>Sort by</span>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as ParsedAssetSearch["sortBy"])}>
              {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button
            type="button" className="button button--ghost"
            onClick={() => setDirection((current) => current === "asc" ? "desc" : "asc")}
          >
            <ArrowDownUp aria-hidden="true" size={14} /> {direction === "asc" ? "Ascending" : "Descending"}
          </button>
        </div>
      ) : null}

      {filtersActive ? (
        <p className="media-filter-summary" role="status">
          Showing {result.matchedCount} of {result.totalCount}: {result.activeFilters.join("; ")}.
          <button type="button" className="link-button" onClick={clearFilters}><X aria-hidden="true" size={12} /> Clear</button>
        </p>
      ) : null}

      <div className="media-view-switch" role="tablist" aria-label="Media view" data-semantic-id="media-view-switch">
        {([
          { id: "grid", label: "Grid", Icon: LayoutGrid },
          { id: "list", label: "List", Icon: List },
          { id: "bins", label: "Bins", Icon: FolderTree },
          { id: "storyboard", label: "Storyboard", Icon: Clapperboard },
        ] as const).map(({ id, label, Icon }) => (
          <button
            key={id} type="button" role="tab" aria-selected={view === id}
            onClick={() => onChangeView(id, id === "bins" ? activeBinId : null)}
          >
            <Icon aria-hidden="true" size={14} /> {label}
          </button>
        ))}
      </div>

      {offlineCount > 0 ? (
        <p className="media-alert" role="status">
          <AlertTriangle aria-hidden="true" size={14} />
          {offlineCount} source{offlineCount === 1 ? "" : "s"} need relinking. Every edit that uses them is preserved.
        </p>
      ) : null}
      {unsupportedCount > 0 ? (
        <p className="media-alert" role="status">
          <AlertTriangle aria-hidden="true" size={14} />
          {unsupportedCount} file{unsupportedCount === 1 ? "" : "s"} cannot be decoded here. They stay in the project with conversion guidance.
        </p>
      ) : null}

      <div
        className={`media-dropzone${dragging ? " media-dropzone--active" : ""}`}
        data-semantic-id="media-import"
        data-agent-target={agentTarget === "media-import" ? "true" : undefined}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => void onDrop(event)}
      >
        <button className="button button--primary" type="button" disabled={busy !== null} onClick={() => void chooseFiles()}>
          <Upload aria-hidden="true" size={15} /> Import media
        </button>
        {supportsFolders ? (
          <button className="button button--secondary" type="button" disabled={busy !== null} onClick={() => void chooseFolder()}>
            <FolderPlus aria-hidden="true" size={15} /> Import folder
          </button>
        ) : (
          <button className="button button--secondary" type="button" disabled title="This browser has no folder picker">
            <FolderPlus aria-hidden="true" size={15} /> Import folder
          </button>
        )}
        <p className="field-help">or drop JPEG, PNG, WebP, AVIF, or GIF files here</p>
        <input
          ref={inputRef} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1}
          onChange={(event) => { void importFiles([...(event.target.files ?? [])]); event.target.value = ""; }}
        />
        <input
          ref={relinkRef} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            const assetId = relinkTargetRef.current;
            event.target.value = "";
            if (!file || !assetId) return;
            void assetService.relinkAsset(assetId, { file, handle: null }, { intent: "Relink a media source." })
              .then((outcome) => onStatus(outcome.losses.length
                ? `Relinked and kept every edit. ${outcome.losses[0]}`
                : "Relinked. A durable copy was stored, so it survives a reload."))
              .catch((error) => onError(error instanceof Error ? error.message : "The relink did not complete."));
          }}
        />
        <input
          ref={replaceRef} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            const assetId = relinkTargetRef.current;
            event.target.value = "";
            if (!file || !assetId) return;
            pendingReplacementFile.current = file;
            void assetService.proposeReplacement(assetId, file)
              .then(setReplacement)
              .catch((error) => onError(error instanceof Error ? error.message : "That replacement could not be inspected."));
          }}
        />
      </div>

      {view === "bins" && organizationService ? (
        <div className="media-bins" data-semantic-id="media-bins">
          <div className="media-bins__head">
            <button
              type="button"
              className={`bin-tree__item${activeBinId === null ? " bin-tree__item--active" : ""}`}
              aria-pressed={activeBinId === null}
              onClick={() => onChangeView("bins", null)}
            >
              <FolderTree aria-hidden="true" size={14} /> <span>All media</span>
            </button>
            <button className="button button--ghost" type="button" onClick={() => void createBin()}>
              <FolderPlus aria-hidden="true" size={14} /> New bin
            </button>
          </div>
          {renderBinTree(null)}
        </div>
      ) : null}

      {result.records.length === 0 ? (
        <div className="panel-empty">
          <ImagePlus aria-hidden="true" size={24} />
          <strong>{filtersActive ? "No matching media" : "No media yet"}</strong>
          <span>{filtersActive ? "Change or clear the filters to see more." : "Import images, video, or audio to build this project's library."}</span>
        </div>
      ) : view === "storyboard" ? (
        <div className="media-storyboard" data-semantic-id="media-storyboard" aria-label="Storyboard">
          {result.records.map((asset, index) => {
            const item = organization.items.find((entry) => entry.itemType === "asset" && entry.itemId === asset.id);
            const Icon = KIND_ICON[asset.reference.kind];
            return (
              <button
                key={asset.id}
                type="button"
                className={`storyboard-card${selectedAssetId === asset.id ? " storyboard-card--selected" : ""}`}
                style={{
                  insetInlineStart: `${item?.storyboardX ?? (index % 4) * 128 + 8}px`,
                  insetBlockStart: `${item?.storyboardY ?? Math.floor(index / 4) * 108 + 8}px`,
                }}
                aria-pressed={selectedAssetId === asset.id}
                onClick={() => onSelectAsset(asset.id === selectedAssetId ? null : asset.id)}
              >
                {thumbnails[asset.id]
                  ? <img src={thumbnails[asset.id]} alt="" width={112} height={64} />
                  : <span className="storyboard-card__placeholder" aria-hidden="true"><Icon size={18} /></span>}
                <span>{asset.reference.name}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <ul className={view === "list" ? "media-list" : "media-grid"}>
          {result.records.map((asset) => {
            const Icon = KIND_ICON[asset.reference.kind];
            const matched = result.matches[asset.id] ?? [];
            return (
              <li key={asset.id}>
                <button
                  type="button"
                  className={`media-tile${selectedAssetId === asset.id ? " media-tile--selected" : ""}`}
                  aria-pressed={selectedAssetId === asset.id}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData("application/estro-asset", asset.id);
                    event.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => onSelectAsset(asset.id === selectedAssetId ? null : asset.id)}
                  onDoubleClick={() => { if (canAddToCanvas) onAddToCanvas(asset.id); }}
                >
                  <span className="media-tile__thumb">
                    {thumbnails[asset.id]
                      ? <img src={thumbnails[asset.id]} alt="" width={64} height={64} />
                      : <span className="media-tile__placeholder" aria-hidden="true"><Icon size={18} /></span>}
                    {asset.availability !== "available" ? <span className="media-tile__badge" aria-hidden="true"><AlertTriangle size={11} /></span> : null}
                    {hasProxy(asset) ? <span className="media-tile__proxy" title="A proxy is available">P</span> : null}
                  </span>
                  <span className="media-tile__meta">
                    <strong>{asset.reference.name}</strong>
                    <small>
                      {asset.reference.kind === "audio"
                        ? `${formatDuration(asset.reference.durationSeconds)} · ${asset.reference.streams.audio?.channels ?? "?"} ch`
                        : `${asset.reference.widthPx} × ${asset.reference.heightPx}${asset.reference.durationSeconds !== null ? ` · ${formatDuration(asset.reference.durationSeconds)}` : ""}`}
                    </small>
                    {asset.availability !== "available" ? <small className="media-tile__state">Needs relinking</small> : null}
                    {asset.editability === "unsupported" ? <small className="media-tile__state">Cannot decode here</small> : null}
                    {matched.length && query ? <small className="media-tile__matched">matched {matched.join(", ")}</small> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}



      {selected ? (
        <section className="media-details" aria-label={`Details for ${selected.reference.name}`}>
          <h3>{selected.reference.name}</h3>
          {catalogueService ? (
            <MarkingPanel
              projectId={projectId}
              assetId={selected.id}
              catalogueService={catalogueService}
              revisionKey={revisionKey}
              onStatus={onStatus}
              onError={onError}
            />
          ) : null}
          <dl className="property-list">
            <div><dt>Kind</dt><dd>{selected.reference.kind}</dd></div>
            <div><dt>Format</dt><dd>{selected.reference.mediaType}</dd></div>
            {selected.reference.kind !== "audio" ? (
              <div><dt>Dimensions</dt><dd>{selected.reference.widthPx} × {selected.reference.heightPx} px</dd></div>
            ) : null}
            {/* Four states, not a boolean. "No audio" and "audio this browser cannot
                decode" call for different actions, and showing both as "none" is what let a
                valid soundtrack disappear without explanation. */}
            <div>
              <dt>Video stream</dt>
              <dd>
                {selected.reference.streams.video
                  ? `${selected.reference.streams.video.widthPx} × ${selected.reference.streams.video.heightPx}${selected.reference.streams.video.codec ? ` · ${selected.reference.streams.video.codec}` : ""}`
                  : describePresence("video", selected.reference.streams.videoPresence)}
              </dd>
            </div>
            <div>
              <dt>Audio stream</dt>
              <dd>
                {selected.reference.streams.audioPresence === "present" && selected.reference.streams.audio
                  ? `${selected.reference.streams.audio.channels} channel(s)${selected.reference.streams.audio.sampleRateHz ? ` at ${selected.reference.streams.audio.sampleRateHz} Hz` : ""}${selected.reference.streams.audio.codec ? ` · ${selected.reference.streams.audio.codec}` : ""}`
                  : describePresence("audio", selected.reference.streams.audioPresence)}
              </dd>
            </div>
            <div>
              <dt>Streams read from</dt>
              <dd>
                {selected.reference.streams.presenceSource === "container"
                  ? "The file's own track list"
                  : selected.reference.streams.presenceSource === "element"
                    ? "What the browser reported"
                    : selected.reference.streams.presenceSource === "decode"
                      ? "A decode attempt"
                      : "Not determined"}
              </dd>
            </div>
            <div><dt>Size</dt><dd>{formatBytes(selected.reference.byteSize)}</dd></div>
            <div><dt>Availability</dt><dd>{selected.availability.replace("_", " ")}</dd></div>
            <div><dt>Editability</dt><dd>{selected.editability.replace("_", " ")}</dd></div>
            <div><dt>Storage</dt><dd>{describeDurability(selected.locator)}</dd></div>
            <div><dt>Proxy</dt><dd>{hasProxy(selected) ? "Generated" : "None"}</dd></div>
            <div><dt>Source revision</dt><dd>{selected.reference.sourceRevision}</dd></div>
            {selected.importPath ? <div><dt>Imported from</dt><dd>{selected.importPath}</dd></div> : null}
            <div><dt>Asset ID</dt><dd><code>{selected.id}</code></dd></div>
          </dl>
          {selected.availabilityReason ? <p className="field-help">{selected.availabilityReason}</p> : null}
          {selected.editabilityReason ? <p className="field-help">{selected.editabilityReason}</p> : null}

          <div className="media-details__actions">
            {selected.reference.kind === "image" ? (
              <button
                className="button button--primary" type="button"
                data-semantic-id="media-add-to-canvas"
                data-agent-target={agentTarget === "media-add-to-canvas" ? "true" : undefined}
                disabled={!canAddToCanvas || selected.availability !== "available"}
                title={canAddToCanvas ? undefined : "Create an image document first"}
                onClick={() => onAddToCanvas(selected.id)}
              >
                <ImagePlus aria-hidden="true" size={15} /> Add to canvas
              </button>
            ) : null}
            <button
              className="button button--ghost" type="button"
              data-semantic-id="media-relink"
              data-agent-target={agentTarget === "media-relink" ? "true" : undefined}
              onClick={() => void relink(selected.id)}
            >
              <Link2 aria-hidden="true" size={15} /> Relink
            </button>
            <button
              className="button button--ghost" type="button"
              data-semantic-id="media-replace"
              onClick={() => void proposeReplace(selected.id)}
            >
              <Repeat aria-hidden="true" size={15} /> Replace source
            </button>
            <button
              className="button button--ghost" type="button"
              data-semantic-id="media-proxy"
              disabled={selected.availability !== "available"}
              onClick={() => void generateProxy(selected.id)}
            >
              <Sparkles aria-hidden="true" size={15} /> Proxy
            </button>
            {organizationService && organization.bins.length ? (
              <label className="slider-field">
                <span>Bin</span>
                <select
                  value={selected.binId ?? ""}
                  onChange={(event) => void moveIntoBin("asset", selected.id, event.target.value || null)}
                >
                  <option value="">All media</option>
                  {organization.bins.map((bin) => <option key={bin.id} value={bin.id}>{bin.name}</option>)}
                </select>
              </label>
            ) : null}
            <button className="button button--ghost" type="button" onClick={() => void remove(selected.id)}>
              <Trash2 aria-hidden="true" size={15} /> Remove
            </button>
          </div>
        </section>
      ) : null}

      {replacement ? (
        <section className="media-proposal" role="dialog" aria-label="Replacement consequences">
          <h3>Replace “{replacement.current.name}”?</h3>
          <dl className="property-list">
            <div><dt>New file</dt><dd>{replacement.proposed.name}</dd></div>
            <div><dt>Dimensions</dt><dd>{replacement.current.widthPx} × {replacement.current.heightPx} → {replacement.proposed.widthPx} × {replacement.proposed.heightPx}</dd></div>
            <div><dt>Format</dt><dd>{replacement.current.mediaType} → {replacement.proposed.mediaType}</dd></div>
            <div><dt>Used by</dt><dd>{count(replacement.affectedLayerIds.length, "layer")}</dd></div>
          </dl>
          {replacement.losses.length ? (
            <ul className="proposal-losses">
              {replacement.losses.map((loss) => <li key={loss}><AlertTriangle aria-hidden="true" size={13} /> {loss}</li>)}
            </ul>
          ) : <p className="field-help">Nothing about the media changes shape, so every edit carries across unchanged.</p>}
          <div className="inspector-actions">
            <button className="button button--ghost" type="button" onClick={() => { setReplacement(null); pendingReplacementFile.current = null; }}>Cancel</button>
            <button className="button button--primary" type="button" disabled={busy === "replace"} onClick={() => void confirmReplace()}>
              Replace and keep edits
            </button>
          </div>
        </section>
      ) : null}

      {storage ? (
        <p className="media-storage" role="status">
          Originals {formatBytes(storage.originalBytes)} · previews {formatBytes(storage.derivedBytes)} of {formatBytes(storage.derivedBudgetBytes)}
          {storage.sessionOnlyAssets ? ` · ${storage.sessionOnlyAssets} session-only` : ""}
        </p>
      ) : null}
    </div>
  );
}
