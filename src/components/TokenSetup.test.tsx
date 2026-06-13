import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { TokenSetup } from "./TokenSetup";
import { useI18nStore } from "../store/useI18nStore";
import * as tauriApi from "../api/tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("../api/tauri");

describe("TokenSetup", () => {
  beforeEach(() => {
    useI18nStore.setState({ lang: "en" });
    vi.clearAllMocks();
    vi.mocked(tauriApi.setToken).mockResolvedValue("testuser");
    vi.mocked(tauriApi.syncGists).mockResolvedValue({ updated: 0, total: 0, incremental: true });
  });
  afterEach(() => cleanup());

  it("renders the Connect button disabled when input is empty", () => {
    render(<TokenSetup />);
    const btn = screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("Connect button enables when a token is typed", () => {
    render(<TokenSetup />);
    fireEvent.change(screen.getByPlaceholderText("ghp_xxxxxxxxxxxx"), { target: { value: "ghp_abc" } });
    const btn = screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("submitting the form calls setToken with the trimmed token", async () => {
    render(<TokenSetup />);
    const input = screen.getByPlaceholderText("ghp_xxxxxxxxxxxx");
    fireEvent.change(input, { target: { value: "  ghp_abc  " } });
    await act(async () => {
      fireEvent.submit(input.closest("form")!);
    });
    expect(vi.mocked(tauriApi.setToken)).toHaveBeenCalledWith("ghp_abc");
  });

  it("shows error message when setToken rejects", async () => {
    vi.mocked(tauriApi.setToken).mockRejectedValue(new Error("bad credentials"));
    render(<TokenSetup />);
    const input = screen.getByPlaceholderText("ghp_xxxxxxxxxxxx");
    fireEvent.change(input, { target: { value: "ghp_bad" } });
    await act(async () => {
      fireEvent.submit(input.closest("form")!);
    });
    expect(screen.getByText("Error: bad credentials")).toBeTruthy();
  });

  it("shows 'Verifying…' during async setToken call", async () => {
    let resolve!: (v: string) => void;
    vi.mocked(tauriApi.setToken).mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<TokenSetup />);
    const input = screen.getByPlaceholderText("ghp_xxxxxxxxxxxx");
    fireEvent.change(input, { target: { value: "ghp_abc" } });
    act(() => { fireEvent.submit(input.closest("form")!); });
    expect(screen.getByRole("button", { name: "Verifying…" })).toBeTruthy();
    // Clean up the dangling promise
    await act(async () => { resolve("user"); });
  });

  it("renders 'Generate a token ↗' link button", () => {
    render(<TokenSetup />);
    expect(screen.getByText("Generate a token ↗")).toBeTruthy();
  });
});
