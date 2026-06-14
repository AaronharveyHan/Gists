import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import { Onboarding } from "./Onboarding";
import { useGistStore } from "../store/useGistStore";
import { useAuthStore } from "../store/useAuthStore";
import { useI18nStore } from "../store/useI18nStore";
import * as api from "../api/tauri";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../api/tauri");
vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn().mockResolvedValue(undefined),
}));

async function flush() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

/** Click through Welcome → GitHub → (connect) → AI step. */
async function gotoAIStep() {
  await act(async () => { fireEvent.click(screen.getByText("Connect GitHub & Get Started →")); });
  fireEvent.change(screen.getByPlaceholderText(/Personal Access Token|ghp_|token/i), { target: { value: "ghp_abc" } });
  await act(async () => { fireEvent.click(screen.getByText("Connect & Sync →")); });
  await flush();
}

describe("Onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
    useGistStore.setState({
      gists: [],
      setAuthenticated: vi.fn(),
      sync: vi.fn().mockResolvedValue(undefined),
    } as never);
    useAuthStore.setState({ setLocalMode: vi.fn() } as never);
    vi.mocked(api.setToken).mockResolvedValue("octocat");
    vi.mocked(api.saveAiConfig).mockResolvedValue(undefined);
    vi.mocked(api.saveSetting).mockResolvedValue(undefined);
    vi.mocked(api.getAiConfig).mockResolvedValue({
      base_url: "", model: "", embedding_model: "", embedding_base_url: "", has_key: false,
    } as never);
  });
  afterEach(() => cleanup());

  // ── Step 0: Welcome ──────────────────────────────────────────────────────────

  it("renders the welcome step with the app title", () => {
    render(<Onboarding />);
    expect(screen.getByText("Gists Client")).toBeTruthy();
  });

  it("renders the four step indicator dots", () => {
    render(<Onboarding />);
    expect(document.querySelectorAll(".ob__step-dot").length).toBe(4);
  });

  it("Connect GitHub advances to the GitHub step", async () => {
    render(<Onboarding />);
    await act(async () => { fireEvent.click(screen.getByText("Connect GitHub & Get Started →")); });
    expect(screen.getByText("Connect GitHub")).toBeTruthy();
  });

  it("Use without GitHub enters local mode", () => {
    render(<Onboarding />);
    fireEvent.click(screen.getByText("Use without GitHub (local mode only)"));
    expect(useAuthStore.getState().setLocalMode).toHaveBeenCalledWith(true);
    expect(useGistStore.getState().setAuthenticated).toHaveBeenCalledWith("local");
  });

  // ── Step 1: GitHub ───────────────────────────────────────────────────────────

  it("Connect button is disabled when the token is empty", async () => {
    render(<Onboarding />);
    await act(async () => { fireEvent.click(screen.getByText("Connect GitHub & Get Started →")); });
    expect((screen.getByText("Connect & Sync →") as HTMLButtonElement).disabled).toBe(true);
  });

  it("connecting with a token calls setToken and advances to AI", async () => {
    render(<Onboarding />);
    await gotoAIStep();
    expect(api.setToken).toHaveBeenCalledWith("ghp_abc");
    expect(screen.getByText("AI Features")).toBeTruthy();
  });

  it("Back returns from the GitHub step to Welcome", async () => {
    render(<Onboarding />);
    await act(async () => { fireEvent.click(screen.getByText("Connect GitHub & Get Started →")); });
    await act(async () => { fireEvent.click(screen.getByText("← Back")); });
    expect(screen.getByText("Connect GitHub & Get Started →")).toBeTruthy();
  });

  it("shows an error when setToken rejects", async () => {
    vi.mocked(api.setToken).mockRejectedValue("bad token");
    render(<Onboarding />);
    await act(async () => { fireEvent.click(screen.getByText("Connect GitHub & Get Started →")); });
    fireEvent.change(screen.getByPlaceholderText(/Personal Access Token|ghp_|token/i), { target: { value: "ghp_bad" } });
    await act(async () => { fireEvent.click(screen.getByText("Connect & Sync →")); });
    await waitFor(() => expect(screen.getByText(/bad token/)).toBeTruthy());
  });

  // ── Step 2: AI ───────────────────────────────────────────────────────────────

  it("renders the AI step with a provider grid", async () => {
    render(<Onboarding />);
    await gotoAIStep();
    expect(screen.getByText("Provider")).toBeTruthy();
  });

  it("Skip for now advances to the Ready step", async () => {
    render(<Onboarding />);
    await gotoAIStep();
    await act(async () => { fireEvent.click(screen.getByText("Skip for now")); });
    await flush();
    expect(screen.getByText("You're all set!")).toBeTruthy();
  });

  it("Save & Continue with an API key calls saveAiConfig", async () => {
    render(<Onboarding />);
    await gotoAIStep();
    const keyInput = screen.getByPlaceholderText(/sk-/i);
    fireEvent.change(keyInput, { target: { value: "sk-test-key" } });
    await act(async () => { fireEvent.click(screen.getByText("Save & Continue →")); });
    await flush();
    expect(api.saveAiConfig).toHaveBeenCalled();
  });

  it("Save & Continue is disabled when the API key is empty", async () => {
    render(<Onboarding />);
    await gotoAIStep();
    expect((screen.getByText("Save & Continue →") as HTMLButtonElement).disabled).toBe(true);
  });

  // ── Step 3: Ready ────────────────────────────────────────────────────────────

  it("the Ready step shows the connected account", async () => {
    render(<Onboarding />);
    await gotoAIStep();
    await act(async () => { fireEvent.click(screen.getByText("Skip for now")); });
    await flush();
    expect(screen.getByText("Connected as @octocat")).toBeTruthy();
  });

  it("the crash-consent checkbox toggles", async () => {
    render(<Onboarding />);
    await gotoAIStep();
    await act(async () => { fireEvent.click(screen.getByText("Skip for now")); });
    await flush();
    const checkbox = document.querySelector('.ob__crash-consent input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
  });

  it("Start saves the error-reporting setting", async () => {
    render(<Onboarding />);
    await gotoAIStep();
    await act(async () => { fireEvent.click(screen.getByText("Skip for now")); });
    await flush();
    await act(async () => { fireEvent.click(screen.getByText("Start using Gists Client →")); });
    expect(api.saveSetting).toHaveBeenCalledWith(
      "error_reporting_enabled",
      expect.any(String),
    );
  });
});
