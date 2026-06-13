import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { SettingsModal } from "./SettingsModal";
import { useI18nStore } from "../store/useI18nStore";
import { useThemeStore } from "../store/useThemeStore";
import * as tauriApi from "../api/tauri";

// ── Mock Tauri IPC and shell ──────────────────────────────────────────────────
// Must precede all imports (vi.mock is hoisted at transform time).
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("../api/tauri");           // resolved by src/api/__mocks__/tauri.ts
vi.mock("../lib/errorReporting", () => ({ initErrorReporting: vi.fn() }));

// SettingsModal's AI config effect expects getAiConfig to resolve on mount.
// The __mocks__ default handles this but we re-confirm it per-suite below.

describe("SettingsModal", () => {
  beforeEach(() => {
    localStorage.clear();
    useI18nStore.setState({ lang: "en" });
    useThemeStore.setState({ vimMode: false, tabCompletion: false, zenMode: false });
    vi.clearAllMocks();
    // Mount-time effects need these to resolve (defaults from __mocks__ are fine).
    vi.mocked(tauriApi.listAccounts).mockResolvedValue([]);
    vi.mocked(tauriApi.getAiConfig).mockResolvedValue({
      base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-turbo",
      embedding_model: "text-embedding-v3",
      embedding_base_url: "",
      has_key: false,
    });
    vi.mocked(tauriApi.getSetting).mockResolvedValue(null);
    vi.mocked(tauriApi.localEmbeddingStatus).mockResolvedValue({
      dir: "", downloaded: false, loaded: false,
    });
  });
  afterEach(() => cleanup());

  // ── Modal lifecycle ─────────────────────────────────────────────────────────

  it("renders the title", async () => {
    render(<SettingsModal onClose={vi.fn()} />);
    expect(screen.getByText("Settings")).toBeTruthy();
  });

  it("Escape closes the modal", async () => {
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("mousedown on the overlay closes, but not on the modal body", () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsModal onClose={onClose} />);

    const overlay = container.querySelector(".modal-overlay") as HTMLElement;
    const modal = container.querySelector("[data-testid='settings-modal']") as HTMLElement;

    fireEvent.mouseDown(modal);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Done button closes the modal", () => {
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    fireEvent.click(screen.getByText("Done"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ── Language ────────────────────────────────────────────────────────────────

  it("clicking 中文 changes store lang to zh", () => {
    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("中文"));
    expect(useI18nStore.getState().lang).toBe("zh");
  });

  it("clicking English changes store lang to en", () => {
    useI18nStore.setState({ lang: "zh" });
    render(<SettingsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("English"));
    expect(useI18nStore.getState().lang).toBe("en");
  });

  // ── Editor toggles ──────────────────────────────────────────────────────────

  it("Vim keybindings checkbox toggles vimMode in the store", () => {
    render(<SettingsModal onClose={vi.fn()} />);
    const cb = screen.getByLabelText("Vim keybindings") as HTMLInputElement;
    expect(cb.checked).toBe(false);
    fireEvent.click(cb);
    expect(useThemeStore.getState().vimMode).toBe(true);
  });

  it("AI Tab Completion checkbox toggles tabCompletion in the store", () => {
    render(<SettingsModal onClose={vi.fn()} />);
    // The label contains a hint span, so getByRole is more reliable than getByLabelText.
    const cb = screen.getByRole("checkbox", { name: /AI Tab Completion/ }) as HTMLInputElement;
    expect(cb.checked).toBe(false);
    fireEvent.click(cb);
    expect(useThemeStore.getState().tabCompletion).toBe(true);
  });

  it("Zen mode checkbox toggles zenMode in the store", () => {
    render(<SettingsModal onClose={vi.fn()} />);
    // Label includes a <kbd> child so match by partial name.
    const cb = screen.getByRole("checkbox", { name: /Zen mode/ }) as HTMLInputElement;
    expect(cb.checked).toBe(false);
    fireEvent.click(cb);
    expect(useThemeStore.getState().zenMode).toBe(true);
  });

  // ── Accounts ────────────────────────────────────────────────────────────────

  it("renders the accounts section and lists loaded accounts", async () => {
    const acct = (id: number, name: string, active: boolean) => ({
      id, name, login: null, avatar_url: null, token_key: "k", is_active: active,
    });
    vi.mocked(tauriApi.listAccounts).mockResolvedValue([acct(1, "alice", true), acct(2, "bob", false)]);
    render(<SettingsModal onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("alice")).toBeTruthy();
      expect(screen.getByText("bob")).toBeTruthy();
    });
  });

  it("shows 'No accounts configured.' when the list is empty", async () => {
    vi.mocked(tauriApi.listAccounts).mockResolvedValue([]);
    render(<SettingsModal onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("No accounts configured.")).toBeTruthy();
    });
  });

  it("Add account button calls addAccount with name and token", async () => {
    vi.mocked(tauriApi.addAccount).mockResolvedValue({
      id: 2, name: "charlie", login: null, avatar_url: null, token_key: "k", is_active: false,
    });
    render(<SettingsModal onClose={vi.fn()} />);

    // Open the add-account form.
    fireEvent.click(screen.getByText("Add account"));
    fireEvent.change(screen.getByPlaceholderText("Account name"), { target: { value: "charlie" } });
    fireEvent.change(screen.getByPlaceholderText("GitHub token"), { target: { value: "tok_abc" } });

    // Save button label is t.common.save = "Save".
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(vi.mocked(tauriApi.addAccount)).toHaveBeenCalledWith("charlie", "tok_abc");
  });

  it("remove account button is visible with 2+ accounts and calls removeAccount", async () => {
    const acct2 = (id: number, name: string, active: boolean) => ({
      id, name, login: null, avatar_url: null, token_key: "k", is_active: active,
    });
    vi.mocked(tauriApi.listAccounts).mockResolvedValue([acct2(1, "alice", true), acct2(2, "bob", false)]);
    // Guard uses window.confirm — stub it to return true.
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    render(<SettingsModal onClose={vi.fn()} />);

    await waitFor(() => screen.getByText("alice"));

    const removeBtn = screen.getAllByTitle("Remove account")[0];
    await act(async () => { fireEvent.click(removeBtn); });

    expect(vi.mocked(tauriApi.removeAccount)).toHaveBeenCalledWith(1);
    vi.unstubAllGlobals();
  });

  // ── Crash reporting ─────────────────────────────────────────────────────────

  it("crash-reporting toggle calls saveSetting with the new value", async () => {
    render(<SettingsModal onClose={vi.fn()} />);
    const cb = screen.getByLabelText("Send anonymous crash reports") as HTMLInputElement;
    await act(async () => { fireEvent.click(cb); });
    expect(vi.mocked(tauriApi.saveSetting)).toHaveBeenCalledWith(
      "error_reporting_enabled",
      "true"
    );
  });
});
