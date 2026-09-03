import { ArrowRight, BookOpen, GitBranch, HardDrive, Undo2, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { assetService, layerService, projectService } from "../app/services";
import { buildSampleProject } from "../application/sample-project";
import { knownPhrases } from "../application/phrase-service";
import { WebMcpChip } from "../components/ui/WebMcpChip";
import { getWebMcpAvailability } from "../webmcp/model-context";
import { ESTRO_TOOL_COUNT, getRegisteredToolCount } from "../webmcp/site-tools";

/**
 * The page a judge, or anyone else, sees first.
 *
 * The claim has to land before anything else does, and the claim is not "another editor".
 * It is that the reason most people never fix their own photographs is vocabulary: the
 * controls are right there, and "saturation" and "temperature" are unfamiliar words for
 * completely familiar ideas. Estro's answer is that you can describe what you want instead —
 * and that watching it happen is how you end up learning the words.
 *
 * One screen, at rest, no scrolling needed to reach the point. No marketing animation; the
 * blueprint reserves motion for an agent actually working.
 */
export function LandingPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [webMcp, setWebMcp] = useState<"available" | "unavailable">("unavailable");
  const [projectCount, setProjectCount] = useState<number | null>(null);
  /** Counted rather than written down, so the claim cannot drift from the vocabulary. */
  const phraseCount = useMemo(() => knownPhrases().length, []);

  useEffect(() => {
    setWebMcp(getWebMcpAvailability());
    let cancelled = false;
    void projectService.listProjects()
      .then((projects) => { if (!cancelled) setProjectCount(projects.length); })
      .catch(() => { if (!cancelled) setProjectCount(0); });
    return () => { cancelled = true; };
  }, []);

  async function loadSample() {
    setBusy(true);
    setError(null);
    try {
      const result = await buildSampleProject({
        projects: projectService, assets: assetService, layers: layerService,
      });
      navigate(`/editor/${result.projectId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The sample project could not be built in this browser.");
      setBusy(false);
    }
  }

  return (
    <div className="landing">
      <header className="landing__bar">
        <Link className="wordmark" to="/projects" aria-label="Estro projects">Estro</Link>
        <WebMcpChip available={webMcp === "available"} />
      </header>

      <main className="landing__main">
        <section className="landing__statement">
          <p className="eyebrow">A photo editor you can talk to</p>
          <h1>You don&rsquo;t need to know what &ldquo;saturation&rdquo; means.</h1>
          <p className="landing__lede">
            Every photo editor assumes you already know the words. Estro doesn&rsquo;t. Say
            &ldquo;a bit warmer&rdquo; to your agent and it moves the real Temperature control,
            then tells you that is what it moved and what temperature does. There is no chat box
            here to learn: the conversation happens where you already are, and this is the
            editor it reaches into.
          </p>

          <div className="landing__actions">
            <button className="button button--primary button--large" type="button" disabled={busy} onClick={() => void loadSample()}>
              <Wand2 aria-hidden="true" size={17} />
              {/* One label for this action across the whole product; the hub says the same. */}
              {busy ? "Loading the sample…" : "Load the sample project"}
            </button>
            <Link className="button button--secondary button--large" to="/projects">
              {projectCount ? `Your ${projectCount} project${projectCount === 1 ? "" : "s"}` : "Start from scratch"}
              <ArrowRight aria-hidden="true" size={17} />
            </Link>
          </div>
          {error ? <p className="field-error landing__error">{error}</p> : null}
          <p className="landing__note">
            Nothing is uploaded. The sample photographs are drawn in your browser, imported
            through the same path your own files take, and stored on this device.
          </p>
        </section>

        <section className="landing__facts" aria-label="How Estro works">
          <article>
            <BookOpen aria-hidden="true" size={19} />
            <h2>It names what it moved</h2>
            <p>
              Ask for &ldquo;warmer&rdquo; and the edit lands with its own explanation: which
              control changed, and what that control actually does. Estro publishes the mapping
              from {phraseCount} ordinary phrases onto its real commands, so the agent resolves
              your words against a fixed vocabulary rather than guessing at them.
            </p>
          </article>
          <article>
            <Undo2 aria-hidden="true" size={19} />
            <h2>Nothing you do is permanent</h2>
            <p>
              Every change, yours or the agent&rsquo;s, is a step you can walk back. Experiment
              badly on purpose. The history says who asked for what, and undoes any of it.
            </p>
          </article>
          <article>
            <HardDrive aria-hidden="true" size={19} />
            <h2>Your photographs stay yours</h2>
            <p>
              Originals live in this browser&rsquo;s private storage. No account, no server, no
              upload — which is also why an agent has to ask you to pick a file.
            </p>
          </article>
          <article>
            <GitBranch aria-hidden="true" size={19} />
            <h2>Same editor, either way</h2>
            <p>
              The agent isn&rsquo;t a chat box bolted on the side. It moves the same controls
              you do, through the same commands, so anything it does you can then adjust by
              hand.
            </p>
          </article>
        </section>
      </main>

      <footer className="landing__footer">
        <p>
          Built for the WebMCP Challenge. {getRegisteredToolCount() || ESTRO_TOOL_COUNT} tools registered on{" "}
          <code>document.modelContext</code>, covering inspection, editing, and export.
        </p>
      </footer>
    </div>
  );
}
