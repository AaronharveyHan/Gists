import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import { QuickSearch } from "./QuickSearch";
import { useI18nStore } from "../store/useI18nStore";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { Gist } from "../api/tauri";

// ── Tauri mocks ────────────────────────────────────────────────────────────────

type EventHandler = (e: { payload: unknown }) => void;

// Shared state must exist before the hoisted vi.mock factories run.
const h = vi.hoisted(() => {
  const eventHandlers: Record<string, EventHandler> = {};
  const register = (name: string, handler: EventHandler) => {
    eventHandlers[name] = handler;
    return Promise.resolve(() => { delete eventHandlers[name]; });
  };
  // getCurrentWindow() must return a stable singleton: it's called from many
  // places and its .listen channel feeds the same eventHandlers registry.
  const win = {
    listen: vi.fn((name: string, handler: EventHandler) => register(name, handler)),
    hide: vi.fn().mockResolvedValue(undefined),
    show: vi.fn().mockResolvedValue(undefined),
    setFocus: vi.fn().mockResolvedValue(undefined),
  };
  const mainWin = {
    show: vi.fn().mockResolvedValue(undefined),
    setFocus: vi.fn().mockResolvedValue(undefined),
  };
  return { eventHandlers, register, win, mainWin };
});

const { eventHandlers, win } = h;

/** Fire an event by exact name (covers both global and window listeners). */
function fireEventByName(name: string, payload: unknown = {}) {
  eventHandlers[name]?.({ payload });
}

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue(""),
  writeText: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn((name: string, handler: EventHandler) => h.register(name, handler)),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => h.win,
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: { getByLabel: vi.fn().mockResolvedValue(h.mainWin) },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGist(overrides: Partial<Gist> = {}): Gist {
  return {
    id: "g1",
    description: "First gist",
    public: true,
    html_url: "",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    files: [{ filename: "a.ts", language: "TypeScript", content: "const x = 1;", size: 12, raw_url: null }],
    ...overrides,
  };
}

/** Make `invoke` dispatch by command name. */
function mockInvoke(map: { list?: Gist[]; search?: Gist[]; create?: Gist }) {
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "list_gists") return Promise.resolve(map.list ?? []) as never;
    if (cmd === "search_gists") return Promise.resolve(map.search ?? []) as never;
    if (cmd === "create_local_gist") return Promise.resolve(map.create ?? makeGist()) as never;
    return Promise.resolve(undefined) as never;
  });
}

async function flush() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("QuickSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
    vi.mocked(readText).mockResolvedValue("");
    mockInvoke({ list: [], search: [] });
    for (const k of Object.keys(eventHandlers)) delete eventHandlers[k];
  });
  afterEach(() => cleanup());

  // ── Search mode ──────────────────────────────────────────────────────────────

  it("renders the search tab by default", async () => {
    render(<QuickSearch />);
    await flush();
    expect(screen.getByPlaceholderText("Search gists…")).toBeTruthy();
  });

  it("loads all gists on mount with an empty query", async () => {
    mockInvoke({ list: [makeGist()] });
    render(<QuickSearch />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("list_gists"));
  });

  it("renders the loaded gist titles", async () => {
    mockInvoke({ list: [makeGist({ description: "My snippet" })] });
    render(<QuickSearch />);
    await waitFor(() => expect(screen.getByText("My snippet")).toBeTruthy());
  });

  it("runs a search query (debounced) via search_gists", async () => {
    mockInvoke({ search: [makeGist({ description: "Hit" })] });
    render(<QuickSearch />);
    await flush();
    fireEvent.change(screen.getByPlaceholderText("Search gists…"), { target: { value: "hit" } });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("search_gists", { query: "hit" }));
  });

  it("Enter copies the selected gist content to the clipboard", async () => {
    mockInvoke({ list: [makeGist({ files: [{ filename: "a.ts", language: "TypeScript", content: "payload", size: 7, raw_url: null }] })] });
    render(<QuickSearch />);
    await waitFor(() => expect(screen.getByText("First gist")).toBeTruthy());
    await act(async () => {
      fireEvent.keyDown(screen.getByPlaceholderText("Search gists…"), { key: "Enter" });
    });
    expect(writeText).toHaveBeenCalledWith("payload");
  });

  it("Cmd+Enter opens the gist via emit + main window", async () => {
    mockInvoke({ list: [makeGist({ id: "gX" })] });
    render(<QuickSearch />);
    await waitFor(() => expect(screen.getByText("First gist")).toBeTruthy());
    await act(async () => {
      fireEvent.keyDown(screen.getByPlaceholderText("Search gists…"), { key: "Enter", metaKey: true });
    });
    expect(emit).toHaveBeenCalledWith("open-gist", { id: "gX" });
  });

  it("Escape hides the window", async () => {
    render(<QuickSearch />);
    await flush();
    fireEvent.keyDown(screen.getByPlaceholderText("Search gists…"), { key: "Escape" });
    expect(win.hide).toHaveBeenCalled();
  });

  it("shows the empty hint when there are no results and no query", async () => {
    render(<QuickSearch />);
    await waitFor(() => expect(screen.getByText("Start typing to search…")).toBeTruthy());
  });

  // ── Mode switching ───────────────────────────────────────────────────────────

  it("clicking the Capture tab switches to capture mode", async () => {
    render(<QuickSearch />);
    await flush();
    await act(async () => { fireEvent.click(screen.getByText("Capture")); });
    expect(screen.getByPlaceholderText("Description or title…")).toBeTruthy();
  });

  it("Tab key in search mode switches to capture", async () => {
    render(<QuickSearch />);
    await flush();
    await act(async () => {
      fireEvent.keyDown(screen.getByPlaceholderText("Search gists…"), { key: "Tab" });
    });
    expect(screen.getByPlaceholderText("Description or title…")).toBeTruthy();
  });

  it("the switch-to-capture event switches to capture mode", async () => {
    render(<QuickSearch />);
    await flush();
    await act(async () => { fireEventByName("switch-to-capture"); });
    expect(screen.getByPlaceholderText("Description or title…")).toBeTruthy();
  });

  it("Back to search returns from capture mode", async () => {
    render(<QuickSearch />);
    await flush();
    await act(async () => { fireEvent.click(screen.getByText("Capture")); });
    await flush();
    await act(async () => { fireEvent.click(screen.getByText("← Search")); });
    expect(screen.getByPlaceholderText("Search gists…")).toBeTruthy();
  });

  // ── Capture mode ─────────────────────────────────────────────────────────────

  it("reads the clipboard on entering capture mode", async () => {
    vi.mocked(readText).mockResolvedValue("print('hello')");
    render(<QuickSearch />);
    await flush();
    await act(async () => { fireEvent.click(screen.getByText("Capture")); });
    await flush();
    expect(readText).toHaveBeenCalled();
    expect(screen.getByText(/print\('hello'\)/)).toBeTruthy();
  });

  it("detects the language of the captured clipboard content", async () => {
    vi.mocked(readText).mockResolvedValue("def foo():\n    import os\n    return 1");
    render(<QuickSearch />);
    await flush();
    await act(async () => { fireEvent.click(screen.getByText("Capture")); });
    await flush();
    // Python content → PY badge
    expect(screen.getByText("PY")).toBeTruthy();
  });

  it("Save Draft is disabled when there is no clipboard content", async () => {
    vi.mocked(readText).mockResolvedValue("");
    render(<QuickSearch />);
    await flush();
    await act(async () => { fireEvent.click(screen.getByText("Capture")); });
    await flush();
    expect((screen.getByText("Save Draft") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Save Draft creates a local gist via create_local_gist", async () => {
    vi.mocked(readText).mockResolvedValue("some captured code");
    mockInvoke({ create: makeGist({ id: "draft1" }) });
    render(<QuickSearch />);
    await flush();
    await act(async () => { fireEvent.click(screen.getByText("Capture")); });
    await flush();
    await act(async () => { fireEvent.click(screen.getByText("Save Draft")); });
    await flush();
    expect(invoke).toHaveBeenCalledWith(
      "create_local_gist",
      expect.objectContaining({ public: false }),
    );
  });

  it("shows the saved confirmation after a draft save", async () => {
    vi.mocked(readText).mockResolvedValue("captured");
    mockInvoke({ create: makeGist({ id: "draft1" }) });
    render(<QuickSearch />);
    await flush();
    await act(async () => { fireEvent.click(screen.getByText("Capture")); });
    await flush();
    await act(async () => { fireEvent.click(screen.getByText("Save Draft")); });
    await waitFor(() => expect(screen.getByText("Saved as draft")).toBeTruthy());
  });

  it("Save & Open emits open-gist and shows the main window", async () => {
    vi.mocked(readText).mockResolvedValue("captured code");
    mockInvoke({ create: makeGist({ id: "opened1" }) });
    render(<QuickSearch />);
    await flush();
    await act(async () => { fireEvent.click(screen.getByText("Capture")); });
    await flush();
    await act(async () => { fireEvent.click(screen.getByText("Save & Open")); });
    await flush();
    expect(emit).toHaveBeenCalledWith("open-gist", { id: "opened1" });
  });
});
