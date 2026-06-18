import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import { Layout } from "./Layout";
import { useGistStore } from "../store/useGistStore";
import { useThemeStore } from "../store/useThemeStore";
import { useI18nStore } from "../store/useI18nStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../api/tauri");

// ── Heavy children → stubs ──────────────────────────────────────────────────
vi.mock("./Toolbar", () => ({
  Toolbar: (p: Record<string, () => void>) => (
    <div data-testid="toolbar">
      <button onClick={() => p.onStats()}>stub-stats</button>
      <button onClick={() => p.onSettings()}>stub-settings</button>
      <button onClick={() => p.onAbout()}>stub-about</button>
    </div>
  ),
}));
vi.mock("./Sidebar", () => ({ Sidebar: () => <div data-testid="sidebar" /> }));
vi.mock("./Editor", () => ({
  Editor: () => <div data-testid="editor" />,
}));
vi.mock("./NewGistModal", () => ({
  NewGistModal: () => <div data-testid="new-gist-modal" />,
}));
vi.mock("./StatusBar", () => ({ StatusBar: () => <div data-testid="statusbar" /> }));
vi.mock("./ToastContainer", () => ({ ToastContainer: () => <div data-testid="toasts" /> }));
vi.mock("./SettingsModal", () => ({ SettingsModal: () => <div data-testid="settings-modal" /> }));
vi.mock("./CommandPalette", () => ({ CommandPalette: () => <div data-testid="palette" /> }));
vi.mock("./ImportModal", () => ({ ImportModal: () => <div data-testid="import-modal" /> }));
vi.mock("./ContentSearch", () => ({ ContentSearch: () => <div data-testid="content-search" /> }));
vi.mock("./StatsPanel", () => ({ StatsPanel: () => <div data-testid="stats-panel" /> }));
vi.mock("./LibraryCleanup", () => ({ LibraryCleanup: () => <div data-testid="cleanup" /> }));
vi.mock("./ShortcutsModal", () => ({ ShortcutsModal: () => <div data-testid="shortcuts" /> }));
vi.mock("./AboutModal", () => ({ AboutModal: () => <div data-testid="about-modal" /> }));
vi.mock("./TemplatesModal", () => ({ TemplatesModal: () => <div data-testid="templates" /> }));
vi.mock("./GraphView", () => ({ GraphView: () => <div data-testid="graph" /> }));

// ── Hooks → no-ops ──────────────────────────────────────────────────────────
vi.mock("../hooks/useAutoSync", () => ({ useAutoSync: vi.fn() }));
vi.mock("../hooks/useUpdateCheck", () => ({ useUpdateCheck: () => null }));

// ── Tauri event listen ──────────────────────────────────────────────────────
type EventHandler = (e: { payload: unknown }) => void;
const eventHandlers: Record<string, EventHandler> = {};
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, handler: EventHandler) => {
    eventHandlers[name] = handler;
    return Promise.resolve(() => { delete eventHandlers[name]; });
  }),
}));

const loadGists = vi.fn().mockResolvedValue(undefined);
const sync = vi.fn();
const selectGist = vi.fn();
const setNetworkOnline = vi.fn();

function seedStore(over: Record<string, unknown> = {}) {
  useGistStore.setState({
    loadGists, sync, selectGist, setNetworkOnline,
    createGist: vi.fn(), createLocalGist: vi.fn(),
    networkOnline: true, githubLogin: "octocat", gists: [],
    ...over,
  } as never);
}

describe("Layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
    useThemeStore.setState({ sidebarWidth: 260, zenMode: false, setSidebarWidth: vi.fn() } as never);
    seedStore();
    for (const k of Object.keys(eventHandlers)) delete eventHandlers[k];
  });
  afterEach(() => cleanup());

  it("loads gists on mount", async () => {
    render(<Layout />);
    await waitFor(() => expect(loadGists).toHaveBeenCalled());
  });

  it("renders the toolbar, sidebar, editor and status bar in normal mode", () => {
    render(<Layout />);
    expect(screen.getByTestId("toolbar")).toBeTruthy();
    expect(screen.getByTestId("sidebar")).toBeTruthy();
    expect(screen.getByTestId("editor")).toBeTruthy();
    expect(screen.getByTestId("statusbar")).toBeTruthy();
  });

  it("hides chrome in zen mode", () => {
    useThemeStore.setState({ sidebarWidth: 260, zenMode: true, setSidebarWidth: vi.fn() } as never);
    render(<Layout />);
    expect(screen.queryByTestId("toolbar")).toBeNull();
    expect(screen.queryByTestId("sidebar")).toBeNull();
    expect(screen.queryByTestId("statusbar")).toBeNull();
    expect(screen.getByTestId("editor")).toBeTruthy();
  });

  it("syncs after load when signed into GitHub", async () => {
    seedStore({ githubLogin: "octocat" });
    render(<Layout />);
    await waitFor(() => expect(sync).toHaveBeenCalled());
  });

  it("does not sync after load in local mode", async () => {
    seedStore({ githubLogin: "local" });
    render(<Layout />);
    await waitFor(() => expect(loadGists).toHaveBeenCalled());
    expect(sync).not.toHaveBeenCalled();
  });

  it("the open-gist event selects the gist", async () => {
    render(<Layout />);
    await waitFor(() => expect(eventHandlers["open-gist"]).toBeTruthy());
    act(() => { eventHandlers["open-gist"]({ payload: { id: "g42" } }); });
    expect(selectGist).toHaveBeenCalledWith("g42");
  });

  it("going offline flips network status", () => {
    render(<Layout />);
    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(setNetworkOnline).toHaveBeenCalledWith(false);
  });

  it("coming online flips network status back", () => {
    render(<Layout />);
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(setNetworkOnline).toHaveBeenCalledWith(true);
  });

  it("opening Stats from the toolbar shows the stats panel", () => {
    render(<Layout />);
    expect(screen.queryByTestId("stats-panel")).toBeNull();
    fireEvent.click(screen.getByText("stub-stats"));
    expect(screen.getByTestId("stats-panel")).toBeTruthy();
  });

  it("opening Settings from the toolbar shows the settings modal", () => {
    render(<Layout />);
    fireEvent.click(screen.getByText("stub-settings"));
    expect(screen.getByTestId("settings-modal")).toBeTruthy();
  });

  it("opening About from the toolbar shows the about modal", () => {
    render(<Layout />);
    expect(screen.queryByTestId("about-modal")).toBeNull();
    fireEvent.click(screen.getByText("stub-about"));
    expect(screen.getByTestId("about-modal")).toBeTruthy();
  });
});
