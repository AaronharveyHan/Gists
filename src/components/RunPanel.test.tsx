import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { RunPanel } from "./RunPanel";
import { useI18nStore } from "../store/useI18nStore";
import * as api from "../api/tauri";
import type { RunRecord } from "../api/tauri";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../api/tauri");

type EventHandler = (e: { payload: unknown }) => void;
const eventHandlers: Record<string, EventHandler> = {};

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, handler: EventHandler) => {
    eventHandlers[name] = handler;
    return Promise.resolve(() => { delete eventHandlers[name]; });
  }),
}));

/** Fire a Tauri event by name prefix. */
function fireIpcEvent(prefix: string, payload: unknown) {
  const key = Object.keys(eventHandlers).find((k) => k.startsWith(prefix));
  key && eventHandlers[key]({ payload });
}

Element.prototype.scrollIntoView = vi.fn();

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 1,
    gist_id: "g1",
    filename: "main.py",
    ran_at: new Date().toISOString(),
    exit_code: 0,
    stdout: "hello",
    stderr: "",
    duration_ms: 120,
    timed_out: false,
    killed: false,
    truncated: false,
    ...overrides,
  };
}

function renderPanel(props: Partial<React.ComponentProps<typeof RunPanel>> = {}) {
  const onClose = vi.fn();
  render(
    <RunPanel
      filename="main.py"
      content="print('hello')"
      runTrigger={0}
      onClose={onClose}
      gistId="g1"
      {...props}
    />,
  );
  return { onClose };
}

describe("RunPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
    for (const k of Object.keys(eventHandlers)) delete eventHandlers[k];
    vi.mocked(api.runCode).mockResolvedValue(undefined);
    vi.mocked(api.killRun).mockResolvedValue(undefined);
    vi.mocked(api.listRunHistory).mockResolvedValue([]);
    vi.mocked(api.diffRuns).mockResolvedValue("");
  });
  afterEach(() => cleanup());

  it("shows filename in header", () => {
    renderPanel();
    expect(screen.getByText("main.py")).toBeTruthy();
  });

  it("shows Ready badge when idle (runTrigger=0)", () => {
    renderPanel();
    expect(screen.getByText("Ready")).toBeTruthy();
  });

  it("shows 'No output yet' when idle", () => {
    renderPanel();
    expect(screen.getByText("No output yet.")).toBeTruthy();
  });

  it("shows Running badge and Stop button when runTrigger > 0", async () => {
    renderPanel({ runTrigger: 1 });
    await waitFor(() => expect(screen.getByText("Running")).toBeTruthy());
    // Stop button text is "⬛ Stop" — match by title instead
    expect(screen.getByTitle("Kill process")).toBeTruthy();
  });

  it("calls runCode when runTrigger increments", async () => {
    renderPanel({ runTrigger: 1 });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(api.runCode).toHaveBeenCalled();
  });

  it("displays stdout lines when run-line events arrive", async () => {
    renderPanel({ runTrigger: 1 });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => {
      fireIpcEvent("run-line-", { text: "hello world", stream: "stdout" });
    });
    expect(screen.getByText("hello world")).toBeTruthy();
  });

  it("displays stderr lines with stderr class", async () => {
    renderPanel({ runTrigger: 1 });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => {
      fireIpcEvent("run-line-", { text: "error occurred", stream: "stderr" });
    });
    const line = screen.getByText("error occurred");
    expect(line.className).toContain("stderr");
  });

  it("transitions to Done badge when run-done fires with exit 0", async () => {
    renderPanel({ runTrigger: 1 });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => {
      fireIpcEvent("run-done-", {
        exit_code: 0, timed_out: false, killed: false,
        stdout: "", stderr: "", duration_ms: 100, truncated: false,
      });
    });
    expect(screen.getByText("Exit 0")).toBeTruthy();
  });

  it("shows error badge when run-done fires with non-zero exit", async () => {
    renderPanel({ runTrigger: 1 });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => {
      fireIpcEvent("run-done-", {
        exit_code: 1, timed_out: false, killed: false,
        stdout: "", stderr: "", duration_ms: 50, truncated: false,
      });
    });
    expect(screen.getByText("Exit 1")).toBeTruthy();
  });

  it("Stop button calls killRun", async () => {
    renderPanel({ runTrigger: 1 });
    await waitFor(() => expect(screen.getByTitle("Kill process")).toBeTruthy());
    fireEvent.click(screen.getByTitle("Kill process"));
    expect(api.killRun).toHaveBeenCalled();
  });

  it("Clear button wipes output", async () => {
    renderPanel({ runTrigger: 1 });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => {
      fireIpcEvent("run-line-", { text: "line1", stream: "stdout" });
    });
    expect(screen.getByText("line1")).toBeTruthy();
    // Clear is disabled while running — finish the run first
    await act(async () => {
      fireIpcEvent("run-done-", {
        exit_code: 0, timed_out: false, killed: false,
        stdout: "", stderr: "", duration_ms: 100, truncated: false,
      });
    });
    fireEvent.click(screen.getByText("Clear"));
    expect(screen.queryByText("line1")).toBeNull();
  });

  it("close button calls onClose", () => {
    const { onClose } = renderPanel();
    fireEvent.click(screen.getByTitle("Close run panel"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows run history section when history is populated", async () => {
    vi.mocked(api.listRunHistory).mockResolvedValue([makeRunRecord()]);
    renderPanel({ runTrigger: 1 });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => {
      fireIpcEvent("run-done-", {
        exit_code: 0, timed_out: false, killed: false,
        stdout: "", stderr: "", duration_ms: 120, truncated: false,
      });
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.getByText(/Run history/)).toBeTruthy();
  });

  it("expands run history when toggle is clicked", async () => {
    vi.mocked(api.listRunHistory).mockResolvedValue([makeRunRecord({ exit_code: 0 })]);
    renderPanel({ runTrigger: 1 });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => {
      fireIpcEvent("run-done-", {
        exit_code: 0, timed_out: false, killed: false,
        stdout: "", stderr: "", duration_ms: 120, truncated: false,
      });
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const toggle = screen.getByText(/Run history/);
    fireEvent.click(toggle);
    expect(screen.getByText("exit 0")).toBeTruthy();
  });

  it("shows run-done timing in header after completion", async () => {
    renderPanel({ runTrigger: 1 });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => {
      fireIpcEvent("run-done-", {
        exit_code: 0, timed_out: false, killed: false,
        stdout: "", stderr: "", duration_ms: 1500, truncated: false,
      });
    });
    expect(screen.getByText(/1\.50s/)).toBeTruthy();
  });
});
