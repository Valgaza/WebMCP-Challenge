import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Trash2 } from "lucide-react";
import type { RenderService } from "../application/render-service";
import type { OutputService } from "../application/output-service";
import type { JobService } from "../application/job-service";
import { detectMediaCapabilities, encodableTypes } from "../media/image-capabilities";
import type { SupportedImageType } from "../domain/asset";
import { outputFileName, summarizeOutput, type OutputRecord } from "../domain/output";
import { formatBytes } from "../data/storage-quota";
import type { ResampleAlgorithm } from "../workers/worker-protocol";

interface ExportPanelProps {
  projectId: string;
  renderService: RenderService;
  outputService: OutputService;
  jobService: JobService;
  revisionKey: string;
  hasDocument: boolean;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
  agentTarget?: string | null;
}

/**
 * One place to deliver anything the project can produce.
 *
 * Only formats this runtime can really encode are offered; the rest are shown disabled with
 * the reason, because a preset that fails at the end of a long render is worse than one that
 * was never offered. Sizes are measured by encoding the real composite, never estimated from
 * a formula, and finished outputs are durable records rather than a single in-memory slot.
 */
export function ExportPanel({
  projectId, renderService, outputService, jobService, revisionKey,
  hasDocument, onStatus, onError, agentTarget,
}: ExportPanelProps) {
  const [outputs, setOutputs] = useState<OutputRecord[]>([]);
  const [busy, setBusy] = useState(false);

  // Photo
  const [formats, setFormats] = useState<SupportedImageType[]>([]);
  const [mediaType, setMediaType] = useState<SupportedImageType>("image/png");
  const [quality, setQuality] = useState(85);
  const [maxEdge, setMaxEdge] = useState<number | "">("");
  const [algorithm, setAlgorithm] = useState<ResampleAlgorithm>("lanczos3");
  const [preview, setPreview] = useState<Awaited<ReturnType<RenderService["previewExport"]>> | null>(null);


  const lossy = mediaType !== "image/png";

  async function measurePhoto() {
    setBusy(true);
    try {
      const result = await renderService.previewExport(projectId, {
        mediaType, quality: quality / 100,
        maxEdgePx: maxEdge === "" ? undefined : Number(maxEdge),
        resampleAlgorithm: algorithm,
        preserveTransparency: true,
      });
      setPreview(result);
      onStatus(`Export preview: ${formatBytes(result.byteSize)} as ${result.mediaType} at ${result.widthPx} × ${result.heightPx}.`);
    } catch (error) {
      onError(error instanceof Error ? error.message : "The export preview did not complete.");
    } finally {
      setBusy(false);
    }
  }

  async function exportPhoto() {
    setBusy(true);
    try {
      const result = await renderService.previewExport(projectId, {
        mediaType, quality: quality / 100,
        maxEdgePx: maxEdge === "" ? undefined : Number(maxEdge),
        resampleAlgorithm: algorithm,
        preserveTransparency: true,
      });
      const record = await outputService.saveOutput({
        projectId, kind: "photo", name: `Image export ${new Date().toLocaleTimeString()}`,
        sourceRevisionId: result.revisionId, scope: "document",
        sequenceId: null, clipId: null, documentId: null, range: null, presetId: null,
        requestedSettings: {
          container: mediaType, videoCodec: null, audioCodec: null,
          widthPx: result.widthPx, heightPx: result.heightPx, frameRate: null,
          videoBitsPerSecond: null, audioBitsPerSecond: null, sampleRateHz: null, channels: null,
          quality: quality / 100,
        },
        actualSettings: {
          container: result.mediaType, videoCodec: null, audioCodec: null,
          widthPx: result.widthPx, heightPx: result.heightPx, frameRate: null,
          videoBitsPerSecond: null, audioBitsPerSecond: null, sampleRateHz: null, channels: null,
          quality: quality / 100,
        },
        mediaType: result.mediaType, durationSeconds: null, frameCount: null,
        warnings: result.warnings, substitutions: result.substituted ? [`Produced ${result.mediaType} instead of ${mediaType}.`] : [],
        jobId: null, blob: result.blob,
      });
      await download(record);
      onStatus(`Exported ${formatBytes(result.byteSize)} as ${result.mediaType}. It is saved in this project's outputs.`);
    } catch (error) {
      onError(error instanceof Error ? error.message : "The export did not complete.");
    } finally {
      setBusy(false);
    }
  }



  async function download(record: OutputRecord) {
    try {
      const blob = await outputService.readOutput(record.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = outputFileName(record);
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      onError(error instanceof Error ? error.message : "That output could not be read.");
    }
  }

  return (
    <section className="export-panel" data-semantic-id="inspector-export" tabIndex={-1} data-agent-target={agentTarget === "inspector-export" ? "true" : undefined}>
      <h3>Export</h3>

        <label className="slider-field" data-semantic-id="export-preset">
          <span>Format</span>
          <select value={mediaType} onChange={(event) => setMediaType(event.target.value as SupportedImageType)}>
            {formats.map((format) => <option key={format} value={format}>{format.replace("image/", "").toUpperCase()}</option>)}
          </select>
        </label>
        {formats.length === 0 ? <p className="field-help">Checking which formats this browser can encode…</p> : null}

        {lossy ? (
          <label className="slider-field">
            <span>Quality <output>{quality}%</output></span>
            <input type="range" min={10} max={100} step={1} value={quality} onChange={(event) => setQuality(Number(event.target.value))} />
          </label>
        ) : (
          <p className="field-help">PNG is lossless, so quality does not apply. It keeps transparency.</p>
        )}
        {mediaType === "image/jpeg" ? (
          <p className="field-help">JPEG has no alpha channel, so transparent areas take the document background.</p>
        ) : null}

        <label className="slider-field">
          <span>Longest edge in pixels</span>
          <input
            type="number" min={16} max={32768} value={maxEdge} placeholder="Full size"
            onChange={(event) => setMaxEdge(event.target.value === "" ? "" : Number(event.target.value))}
          />
        </label>
        {maxEdge !== "" ? (
          <label className="slider-field">
            <span>Resampling</span>
            <select value={algorithm} onChange={(event) => setAlgorithm(event.target.value as ResampleAlgorithm)}>
              <option value="lanczos3">Lanczos 3 — sharpest</option>
              <option value="bilinear">Bilinear — smooth</option>
              <option value="nearest">Nearest neighbour — hard pixels</option>
              <option value="browser-smooth">Browser default</option>
            </select>
          </label>
        ) : null}

        <div className="inspector-actions">
          <button className="button button--secondary" type="button" disabled={busy} onClick={() => void measurePhoto()}>
            Preview size
          </button>
          <button
            className="button button--primary" type="button" disabled={busy}
            data-semantic-id="export-start"
            data-agent-target={agentTarget === "export-start" ? "true" : undefined}
            onClick={() => void exportPhoto()}
          >
            <Download aria-hidden="true" size={15} /> Export image
          </button>
        </div>

        {preview ? (
          <dl className="property-list">
            <div><dt>Size</dt><dd>{formatBytes(preview.byteSize)}</dd></div>
            <div><dt>Dimensions</dt><dd>{preview.widthPx} × {preview.heightPx} px</dd></div>
            <div><dt>Produced</dt><dd>{preview.mediaType}</dd></div>
            <div><dt>Resampling</dt><dd>{preview.resampleAlgorithm}</dd></div>
            <div><dt>Alpha</dt><dd>{preview.hasAlpha ? "kept" : "flattened"}</dd></div>
          </dl>
        ) : (
          <p className="field-help">Preview the size to measure the real encoded output before exporting.</p>
        )}
        {preview?.warnings.map((warning) => (
          <p key={warning} className="media-alert" role="status"><AlertTriangle aria-hidden="true" size={14} />{warning}</p>
        ))}
      <section className="output-list" data-semantic-id="output-list" aria-label="Finished outputs">
        <h3>Outputs</h3>
        {outputs.length === 0 ? (
          <p className="field-help">Nothing rendered yet. Finished exports are kept here so they survive a reload.</p>
        ) : (
          <ul>
            {outputs.map((output) => (
              <li key={output.id} className={output.available ? undefined : "output-row--missing"}>
                <div>
                  <strong>{output.name}</strong>
                  <small>{summarizeOutput(output)}</small>
                  {output.substitutions.map((entry) => <small key={entry} className="output-row__warning">{entry}</small>)}
                </div>
                <div className="output-row__actions">
                  <button
                    className="button button--ghost" type="button" disabled={!output.available}
                    onClick={() => void download(output)}
                  >
                    <Download aria-hidden="true" size={14} /> Download
                  </button>
                  <button
                    className="icon-button icon-button--tight" type="button"
                    aria-label={`Delete ${output.name}`}
                    onClick={() => void outputService.deleteOutput(output.id).then(() => onStatus(`Deleted “${output.name}”.`))}
                  >
                    <Trash2 aria-hidden="true" size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
