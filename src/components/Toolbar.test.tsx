import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import { Toolbar } from "./Toolbar";
import { useGistStore } from "../store/useGistStore";
import { useAuthStore } from "../store/useAuthStore";
import { useI18nStore } from "../store/useI18nStore";
import * as api from "../api/tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../api/tauri");
vi.mock("./AccountSwitcher", () => ({
  AccountSwitcher: () => <div data-testid="account-switcher" />,
}));

const dialog = { save: vi.fn(), open: vi.fn() };
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...a: unknown[]) => dialog.save(...a),
  open: (...a: unknown[]) => dialog.open(...a),
}));

const sync = vi.fn();
const logout = vi.fn();

function seedStore(over: Record<string, unknown> = {}) {
  useGistStore.setState({
    githubLogin: "octocat",
    logout,
    sync,
    syncStatus: "idle",
    syncError: null,
    lastSyncResult: null,
    ...over,
  } as never);
}

function renderToolbar() {
  const cbs = {
    onSettings: vi.fn(), onPalette: vi.fn(), onImport: vi.fn(), onStats: vi.fn(),
    onShortcuts: vi.fn(), onTemplates: vi.fn(), onGraph: vi.fn(), onCleanup: vi.fn(),
  };
  render(<Toolbar {...cbs} />);
  return cbs;
}

describe("Toolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
    useAuthStore.setState({ setLocalMode: vi.fn() } as never);
    seedStore();
  });
  afterEach(() => cleanup());

  it("renders the toolbar title", () => {
    renderToolbar();
    expect(screen.getByText("Gists")).toBeTruthy();
  });

  it("shows Sync and Full buttons in GitHub (non-local) mode", () => {
    renderToolbar();
    expect(screen.getByTitle(/incremental/i)).toBeTruthy();
    expect(screen.getByText("Full")).toBeTruthy();
  });

  it("clicking Sync triggers an incremental sync", () => {
    renderToolbar();
    fireEvent.click(screen.getByText("Sync"));
    expect(sync).toHaveBeenCalledWith(false);
  });

  it("clicking Full triggers a full sync", () => {
    renderToolbar();
    fireEvent.click(screen.getByText("Full"));
    expect(sync).toHaveBeenCalledWith(true);
  });

  it("the Sync button is disabled and labelled while syncing", () => {
    seedStore({ syncStatus: "syncing" });
    renderToolbar();
    const btn = screen.getByText("Syncing…") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("toolbar action buttons fire their callbacks", () => {
    const cbs = renderToolbar();
    fireEvent.click(screen.getByText("Search"));
    fireEvent.click(screen.getByText("Stats"));
    fireEvent.click(screen.getByText("Templates"));
    fireEvent.click(screen.getByText("Settings"));
    expect(cbs.onPalette).toHaveBeenCalled();
    expect(cbs.onStats).toHaveBeenCalled();
    expect(cbs.onTemplates).toHaveBeenCalled();
    expect(cbs.onSettings).toHaveBeenCalled();
  });

  it("Export saves to a chosen path and calls exportGists", async () => {
    dialog.save.mockResolvedValue("/tmp/backup.json");
    vi.mocked(api.exportGists).mockResolvedValue(12);
    renderToolbar();
    await act(async () => { fireEvent.click(screen.getByText("Export")); });
    await waitFor(() => expect(api.exportGists).toHaveBeenCalledWith("/tmp/backup.json"));
  });

  it("Export is a no-op when the save dialog is cancelled", async () => {
    dialog.save.mockResolvedValue(null);
    renderToolbar();
    await act(async () => { fireEvent.click(screen.getByText("Export")); });
    expect(api.exportGists).not.toHaveBeenCalled();
  });

  it("Import passes the chosen file path to onImport", async () => {
    dialog.open.mockResolvedValue("/tmp/in.json");
    const cbs = renderToolbar();
    await act(async () => { fireEvent.click(screen.getByText("Import")); });
    await waitFor(() => expect(cbs.onImport).toHaveBeenCalledWith("/tmp/in.json"));
  });

  it("Logout clears the token after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderToolbar();
    await act(async () => { fireEvent.click(screen.getByText("Logout")); });
    await waitFor(() => expect(api.clearToken).toHaveBeenCalled());
    expect(logout).toHaveBeenCalled();
  });

  it("Logout is cancelled when the user declines the confirm", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderToolbar();
    await act(async () => { fireEvent.click(screen.getByText("Logout")); });
    expect(api.clearToken).not.toHaveBeenCalled();
  });

  it("local mode hides sync and shows the local badge + Connect GitHub", () => {
    seedStore({ githubLogin: "local" });
    renderToolbar();
    expect(screen.getByText("Local")).toBeTruthy();
    expect(screen.getByText("Connect GitHub")).toBeTruthy();
    expect(screen.queryByText("Full")).toBeNull();
  });

  it("renders the AccountSwitcher in GitHub mode", () => {
    renderToolbar();
    expect(screen.getByTestId("account-switcher")).toBeTruthy();
  });
});
