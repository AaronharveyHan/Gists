import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { runCode, killRun } from "../api/tauri";
import type { RunLine, RunDone } from "../api/tauri";
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
}

const IDLE: RunState = { status: "idle", exitCode: null, timedOut: false, killed: false };

export function RunPanel({
  filename,
  content,
  runTrigger,
  onClose,
}: {
  filename: string;
  content: string;
  /** Increment to trigger a new run. */
  runTrigger: number;
  onClose: () => void;
}) {
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [state, setState] = useState<RunState>(IDLE);
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
    setState({ status: "running", exitCode: null, timedOut: false, killed: false });

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

      unlistenDone = await listen<RunDone>(`run-done-${id}`, (e) => {
        setState({
          status: "done",
          exitCode: e.payload.exit_code,
          timedOut: e.payload.timed_out,
          killed: e.payload.killed,
        });
        if (activeRunId.current === id) activeRunId.current = null;
        cleanup();
      });

      try {
        await runCode(id, filename, content);
      } catch (e) {
        const msg = String(e);
        notify("Run failed: " + msg);
        const n = ++lineCount.current;
        setOutput((prev) => [...prev, { id: n, text: msg, stream: "stderr" }]);
        setState({ status: "done", exitCode: -1, timedOut: false, killed: false });
        cleanup();
      }
    };

    start();

    return () => {
      // If the effect re-runs (e.g. runTrigger changes again), kill the old run
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

  const statusBadge = () => {
    if (state.status === "running") return { label: "Running", cls: "running" };
    if (state.status === "idle") return { label: "Ready", cls: "idle" };
    if (state.killed) return { label: "Killed", cls: "err" };
    if (state.timedOut) return { label: "Timed out", cls: "err" };
    if (state.exitCode === 0) return { label: "Exit 0", cls: "ok" };
    return { label: `Exit ${state.exitCode}`, cls: "err" };
  };

  const badge = statusBadge();

  return (
    <div className="run-panel">
      <div className="run-panel__head">
        <span className={`run-panel__badge run-panel__badge--${badge.cls}`}>
          {badge.label}
        </span>
        <span className="run-panel__filename">{filename}</span>
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
          <button
            className="btn run-panel__clear"
            onClick={() => setOutput([])}
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
        {output.length === 0 && state.status !== "running" && (
          <span className="run-panel__empty">No output yet.</span>
        )}
        {output.map((line) => (
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
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
