import { useEffect, useState } from "react";
import { AlertTriangle, ListChecks, RotateCcw, X } from "lucide-react";
import { JOB_STATUS_LABELS, isTerminalJobStatus, summarizeJob, type JobRecord } from "../domain/job";
import type { JobService } from "../application/job-service";
import { count } from "../domain/plural";

interface JobCenterProps {
  projectId: string;
  jobService: JobService;
  onStatus: (message: string) => void;
  onRevealOutput?: (outputId: string) => void;
  agentTarget?: string | null;
}

/**
 * The durable end of the wait ladder.
 *
 * Work longer than a moment escalates here with its stage, real progress when it is
 * measurable, cancellation, retry, and final outcome. An interrupted job says so rather than
 * showing a progress bar for work nothing is doing.
 */
export function JobCenter({ projectId, jobService, onStatus, onRevealOutput, agentTarget }: JobCenterProps) {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const load = () => { void jobService.listJobs(projectId, 25).then((next) => { if (active) setJobs(next); }); };
    load();
    const unsubscribe = jobService.subscribe((job) => { if (job.projectId === projectId) load(); });
    return () => { active = false; unsubscribe(); };
  }, [jobService, projectId]);

  const running = jobs.filter((job) => !isTerminalJobStatus(job.status));
  const needsAttention = jobs.filter((job) => job.status === "failed" || job.status === "interrupted");

  return (
    <>
      <button
        className="icon-button job-center-trigger"
        type="button"
        data-semantic-id="job-center"
        data-agent-target={agentTarget === "job-center" ? "true" : undefined}
        aria-label={
          running.length
            ? `Job Center, ${running.length} running${needsAttention.length ? `, ${needsAttention.length} needing attention` : ""}`
            : needsAttention.length ? `Job Center, ${needsAttention.length} needing attention` : "Job Center"
        }
        aria-expanded={open}
        aria-controls="job-center-drawer"
        onClick={() => setOpen((value) => !value)}
      >
        <ListChecks aria-hidden="true" size={17} />
        {running.length ? <span className="job-center-trigger__count">{running.length}</span> : null}
        {!running.length && needsAttention.length ? <span className="job-center-trigger__count job-center-trigger__count--warn">!</span> : null}
      </button>

      {open ? (
        <section id="job-center-drawer" className="job-center" aria-label="Job Center">
          <div className="job-center__head">
            <h2>Jobs</h2>
            <button className="icon-button" type="button" aria-label="Close Job Center" onClick={() => setOpen(false)}>
              <X aria-hidden="true" size={16} />
            </button>
          </div>

          {jobs.length === 0 ? (
            <p className="field-help">No background work has run for this project yet.</p>
          ) : (
            <ul className="job-list">
              {jobs.map((job) => (
                <li key={job.id} className={`job-row job-row--${job.status}`}>
                  <div className="job-row__head">
                    <strong>{job.label}</strong>
                    <span className={`job-status job-status--${job.status}`}>{JOB_STATUS_LABELS[job.status]}</span>
                  </div>
                  <p>{summarizeJob(job)}</p>
                  {job.progress.determinate && job.progress.totalUnits ? (
                    <progress
                      max={job.progress.totalUnits}
                      value={job.progress.completedUnits ?? 0}
                      aria-label={`${job.label} progress`}
                    />
                  ) : !isTerminalJobStatus(job.status) ? (
                    <p className="job-row__indeterminate" role="status">
                      This work cannot report a percentage, so it reports its stage instead.
                    </p>
                  ) : null}

                  <dl className="job-row__facts">
                    <div><dt>Priority</dt><dd>{job.priority}</dd></div>
                    {job.ranInWorker ? <div><dt>Ran</dt><dd>off the interface thread</dd></div> : null}
                    {job.derivativeIds.length ? <div><dt>Generated</dt><dd>{count(job.derivativeIds.length, "preview file")}</dd></div> : null}
                    {job.outputIds.length ? <div><dt>Produced</dt><dd>{count(job.outputIds.length, "output")}</dd></div> : null}
                  </dl>

                  {job.warnings.map((warning) => (
                    <p key={warning} className="job-row__warning">
                      <AlertTriangle aria-hidden="true" size={12} /> {warning}
                    </p>
                  ))}
                  {job.failureMessage ? <p className="job-row__warning">{job.failureMessage}</p> : null}

                  <div className="job-row__actions">
                    {!isTerminalJobStatus(job.status) && job.cancellable ? (
                      <button
                        className="button button--ghost" type="button"
                        disabled={job.cancelRequested}
                        onClick={() => void jobService.cancelJob(job.id).then((outcome) => onStatus(outcome.reason))}
                      >
                        {job.cancelRequested ? "Stopping…" : "Cancel"}
                      </button>
                    ) : null}
                    {(job.status === "failed" || job.status === "cancelled" || job.status === "interrupted") ? (
                      <button
                        className="button button--ghost"
                        type="button"
                        disabled={!job.retryable && job.status === "failed"}
                        title={job.retryable || job.status !== "failed" ? undefined : "This failure will not resolve on a retry."}
                        onClick={() => void jobService.retryJob(job.id)
                          .then((retried) => onStatus(`Retrying as job ${retried.id.slice(0, 8)}.`))
                          .catch((error) => onStatus(error instanceof Error ? error.message : "This job cannot be retried."))}
                      >
                        <RotateCcw aria-hidden="true" size={14} /> Retry
                      </button>
                    ) : null}
                    {job.outputIds.length && onRevealOutput ? (
                      <button className="button button--ghost" type="button" onClick={() => onRevealOutput(job.outputIds[0])}>
                        Show result
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </>
  );
}
