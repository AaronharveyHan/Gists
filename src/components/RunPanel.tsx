import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { runCode, killRun, listRunHistory, diffRuns } from "../api/tauri";
import type { RunLine, RunDone, RunRecord } from "../api/tauri";
import { notify } from "../store/useNotificationStore";

interface OutputLine {
  id: number;
  text: string;
  stream: "stdout" | "stderr";
}

type RunStatus = "idle" | "running" | "done";

interface RunState {
  status: RunStatus;
  exitCode: number | null;
  timedOut: boolean;
  killed: boolean;
  durationMs: number | null;
}

const IDLE: RunState = {
  status: "idle", exitCode: null, timedOut: false, killed: false, durationMs: null,
};

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatRelTime(isoStr: string): string {
  try {
    const diff = Date.now() - new Date(isoStr).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return new Date(isoStr).toLocaleDateString();
  } catch {
    return isoStr;
  }
}

function DiffView({ text }: { text: string }) {
  if (!text.trim()) {
    return <div className="run-diff__empty">No output differences between runs.</div>;
  }
  return (
    <div className="run-diff__body">
      {text.split("\n").map((line, i) => {
        const cls =
          line.startsWith("+") && !line.startsWith("+++")
            ? "run-diff__line--add"
            : line.startsWith("-") && !line.startsWith("---")
            ? "run-diff__line--del"
            : line.startsWith("@@")
            ? "run-diff__line--hunk"
            : line.startsWith("---") || line.startsWith("+++")
            ? "run-diff__line--meta"
            : "run-diff__line--ctx";
        return (
          <div key={i} className={`run-diff__line ${cls}`}>
            {line || "​"}
          </div>
        );
      })}
    </div>
  );
}

export function RunPanel({
  filename,
  content,
  runTrigger,
  onClose,
  gistId = "",
}: {
  filename: string;
  content: string;
  /** Increment to trigger a new run. */
  runTrigger: number;
  onClose: () => void;
  gistId?: string;
}) {
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [state, setState] = useState<RunState>(IDLE);
  const [history, setHistory] = useState<RunRecord[]>([]);
  const [showDiff, setShowDiff] = useState(false);
  const [diffText, setDiffText] = useState("");
  const [diffLoading, setDiffLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyOutput, setHistoryOutput] = useState<RunRecord | null>(null);
  const activeRunId = useRef<string | null>(null);
  const lineCount = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll when new lines arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [output.length]);

  // Start a run every time runTrigger increments
  useEffect(() => {
    if (runTrigger === 0) return;

    const id = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    activeRunId.current = id;
    lineCount.current = 0;
    setOutput([]);
    setShowDiff(false);
    setDiffText("");
    setHistoryOutput(null);
    setState({ status: "running", exitCode: null, timedOut: false, killed: false, durationMs: null });

    let cancelled = false;
    let unlistenLine: (() => void) | null = null;
    let unlistenDone: (() => void) | null = null;

    const cleanup = () => {
      unlistenLine?.();
      unlistenDone?.();
    };

    const start = async () => {
      unlistenLine = await listen<RunLine>(`run-line-${id}`, (e) => {
        const n = ++lineCount.current;
        setOutput((prev) => [
          ...prev,
          { id: n, text: e.payload.text, stream: e.payload.stream },
        ]);
      });
      // Cleanup ran while we were awaiting listen — bail out immediately.
      if (cancelled) { cleanup(); return; }

      unlistenDone = await listen<RunDone>(`run-done-${id}`, async (e) => {
        const d = e.payload;
        setState({
          status: "done",
          exitCode: d.exit_code,
          timedOut: d.timed_out,
          killed: d.killed,
          durationMs: d.duration_ms,
        });
        if (activeRunId.current === id) activeRunId.current = null;
        cleanup();

        // Fetch updated history after run is saved to DB.
        if (gistId && filename) {
          try {
            const hist = await listRunHistory(gistId, filename);
            setHistory(hist);
          } catch {}
        }
      });
      if (cancelled) { cleanup(); return; }

      try {
        await runCode(id, gistId, filename, content);
      } catch (e) {
        const msg = String(e);
        notify("Run failed: " + msg);
        const n = ++lineCount.current;
        setOutput((prev) => [...prev, { id: n, text: msg, stream: "stderr" }]);
        setState({ status: "done", exitCode: -1, timedOut: false, killed: false, durationMs: null });
        cleanup();
      }
    };

    start();

    return () => {
      cancelled = true;
      if (activeRunId.current === id) {
        killRun(id).catch(() => {});
      }
      cleanup();
    };
  }, [runTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleKill = () => {
    if (activeRunId.current) {
      killRun(activeRunId.current).catch(() => {});
    }
  };

  const handleToggleDiff = async () => {
    if (showDiff) {
      setShowDiff(false);
      return;
    }
    if (history.length < 2) return;
    setDiffLoading(true);
    try {
      const diff = await diffRuns(history[0].id, history[1].id);
      setDiffText(diff);
      setShowDiff(true);
    } catch {
      notify("Failed to compute diff");
    } finally {
      setDiffLoading(false);
    }
  };

  const statusBadge = () => {
    if (state.status === "running") return { label: "Running", cls: "running" };
    if (state.status === "idle") return { label: "Ready", cls: "idle" };
    if (state.killed) return { label: "Killed", cls: "err" };
    if (state.timedOut) return { label: "Timed out", cls: "err" };
    if (state.exitCode === 0) return { label: "Exit 0", cls: "ok" };
    return { label: `Exit ${state.exitCode}`, cls: "err" };
  };

  const badge = statusBadge();

  // Decide what to show in the output area
  const displayOutput = historyOutput ? null : output;

  return (
    <div className="run-panel">
      <div className="run-panel__head">
        <div className="run-panel__term-dots" aria-hidden>
          <span className="run-panel__term-dot run-panel__term-dot--red" />
          <span className="run-panel__term-dot run-panel__term-dot--yellow" />
          <span className="run-panel__term-dot run-panel__term-dot--green" />
        </div>
        <span className={`run-panel__badge run-panel__badge--${badge.cls}`}>
          {badge.label}
        </span>
        <span className="run-panel__filename">{filename}</span>

        {state.status === "done" && state.durationMs !== null && (
          <span className="run-panel__timing">
            {`Finished in ${formatDuration(state.durationMs)} · exit ${state.exitCode}`}
          </span>
        )}

        <div className="run-panel__actions">
          {state.status === "running" ? (
            <button
              className="btn btn--danger run-panel__kill"
              onClick={handleKill}
              title="Kill process"
            >
              ⬛ Stop
            </button>
          ) : (
            <span className="run-panel__idle-hint">
              Click ▶ Run to execute again
            </span>
          )}

          {state.status === "done" && history.length >= 2 && (
            <button
              className={`btn run-panel__vs-btn${showDiff ? " run-panel__vs-btn--active" : ""}`}
              onClick={handleToggleDiff}
              disabled={diffLoading}
              title="Compare output with previous run"
            >
              {diffLoading ? "…" : showDiff ? "Hide diff" : "vs last run"}
            </button>
          )}

          <button
            className="btn run-panel__clear"
            onClick={() => { setOutput([]); setHistoryOutput(null); }}
            title="Clear output"
            disabled={state.status === "running"}
          >
            Clear
          </button>
          <button
            className="btn run-panel__close"
            onClick={onClose}
            title="Close run panel"
          >
            ×
          </button>
        </div>
      </div>

      <div className="run-panel__output" role="log" aria-live="polite">
        {historyOutput ? (
          <div className="run-panel__hist-view">
            <div className="run-panel__hist-view-bar">
              <span>
                {formatRelTime(historyOutput.ran_at)} · exit {historyOutput.exit_code} · {formatDuration(historyOutput.duration_ms)}
              </span>
              <button className="btn" onClick={() => setHistoryOutput(null)}>✕ Back to current</button>
            </div>
            {historyOutput.stdout
              ? historyOutput.stdout.split("\n").map((line, i) => (
                  <div key={i} className="run-panel__line run-panel__line--stdout">{line}</div>
                ))
              : <span className="run-panel__empty">No output.</span>
            }
          </div>
        ) : (
          <>
            {displayOutput!.length === 0 && state.status !== "running" && (
              <span className="run-panel__empty">No output yet.</span>
            )}
            {displayOutput!.map((line) => (
              <div
                key={line.id}
                className={`run-panel__line run-panel__line--${line.stream}`}
              >
                {line.text}
              </div>
            ))}
            {state.status === "running" && (
              <span className="run-panel__cursor" aria-hidden />
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {showDiff && (
        <div className="run-diff">
          <div className="run-diff__header">Output diff: current vs previous run</div>
          <DiffView text={diffText} />
        </div>
      )}

      {history.length > 0 && (
        <div className="run-history">
          <button
            className="run-history__toggle"
            onClick={() => setHistoryOpen((o) => !o)}
          >
            {historyOpen ? "▴" : "▾"} Run history ({history.length})
          </button>
          {historyOpen && (
            <div className="run-history__list">
              {history.map((run) => (
                <div
                  key={run.id}
                  className={`run-history__item${historyOutput?.id === run.id ? " run-history__item--active" : ""}`}
                  onClick={() => setHistoryOutput(run)}
                  title="Click to view this run's output"
                >
                  <span className="run-history__time">{formatRelTime(run.ran_at)}</span>
                  <span
                    className={`run-history__exit run-history__exit--${
                      run.timed_out || run.killed ? "err"
                      : run.exit_code === 0 ? "ok"
                      : "err"
                    }`}
                  >
                    {run.timed_out ? "timeout" : run.killed ? "killed" : `exit ${run.exit_code}`}
                  </span>
                  <span className="run-history__dur">{formatDuration(run.duration_ms)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
