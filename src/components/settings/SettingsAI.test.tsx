import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { SettingsAI } from "./SettingsAI";
import { useI18nStore } from "../../store/useI18nStore";
import * as tauriApi from "../../api/tauri";

// vi.mock is hoisted — must precede imports that touch these modules.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("../../api/tauri"); // resolves to src/api/__mocks__/tauri.ts

const DASHSCOPE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

function mockConfig(over: Partial<tauriApi.AiConfig> = {}) {
  vi.mocked(tauriApi.getAiConfig).mockResolvedValue({
    base_url: DASHSCOPE_URL,
    model: "qwen-turbo",
    embedding_model: "text-embedding-v3",
    embedding_base_url: "",
    has_key: false,
    ...over,
  });
}

async function renderAI() {
  render(<SettingsAI />);
  // let mount-time effects (getAiConfig, getSetting, localEmbeddingStatus) settle
  await waitFor(() => screen.getByText("AI Integration"));
}

describe("SettingsAI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
    mockConfig();
    vi.mocked(tauriApi.getSetting).mockResolvedValue(null);
    vi.mocked(tauriApi.localEmbeddingStatus).mockResolvedValue({
      dir: "/home/u/.cache/model", downloaded: false, loaded: false,
    });
    vi.mocked(tauriApi.saveAiConfig).mockResolvedValue(undefined);
    vi.mocked(tauriApi.saveSetting).mockResolvedValue(undefined);
    vi.mocked(tauriApi.downloadLocalEmbeddingModel).mockResolvedValue(undefined);
  });
  afterEach(() => cleanup());

  it("renders the AI section title", async () => {
    await renderAI();
    expect(screen.getByText("AI Integration")).toBeTruthy();
  });

  it("loads the saved AI config into the inputs on mount", async () => {
    mockConfig({ base_url: "https://api.openai.com/v1", model: "gpt-4o-mini" });
    await renderAI();
    await waitFor(() => {
      expect((screen.getByDisplayValue("https://api.openai.com/v1") as HTMLInputElement)).toBeTruthy();
      expect((screen.getByDisplayValue("gpt-4o-mini") as HTMLInputElement)).toBeTruthy();
    });
  });

  it("shows the 'Saved' key badge when has_key is true", async () => {
    mockConfig({ has_key: true });
    await renderAI();
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
  });

  it("picking a provider preset fills the base URL and chat model", async () => {
    await renderAI();
    // Click the OpenAI preset card (title = its tagline; match by label text).
    fireEvent.click(screen.getByText("OpenAI"));
    await waitFor(() => {
      expect(screen.getByDisplayValue("https://api.openai.com/v1")).toBeTruthy();
      expect(screen.getByDisplayValue("gpt-4o-mini")).toBeTruthy();
    });
  });

  it("Save AI Config calls saveAiConfig with the current field values", async () => {
    await renderAI();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save AI Config" }));
    });
    expect(vi.mocked(tauriApi.saveAiConfig)).toHaveBeenCalledWith(
      DASHSCOPE_URL, "", "qwen-turbo", "text-embedding-v3", ""
    );
  });

  it("warns when the embedding model looks like a chat model", async () => {
    await renderAI();
    const embedInput = screen.getByDisplayValue("text-embedding-v3");
    fireEvent.change(embedInput, { target: { value: "gpt-4o" } });
    await waitFor(() => {
      // chatModelWarn text is rendered in a .settings-warn div
      expect(document.querySelector(".settings-warn")).toBeTruthy();
    });
  });

  it("switching to Local embedding saves the provider and reveals the download button", async () => {
    await renderAI();
    fireEvent.click(screen.getByText("Local (offline)"));
    expect(vi.mocked(tauriApi.saveSetting)).toHaveBeenCalledWith("embedding_provider", "local");
    await waitFor(() => {
      expect(screen.getByText("Download model (~90 MB)")).toBeTruthy();
    });
  });

  it("Download model button calls downloadLocalEmbeddingModel", async () => {
    await renderAI();
    fireEvent.click(screen.getByText("Local (offline)"));
    const dlBtn = await screen.findByText("Download model (~90 MB)");
    await act(async () => { fireEvent.click(dlBtn); });
    expect(vi.mocked(tauriApi.downloadLocalEmbeddingModel)).toHaveBeenCalled();
  });

  it("editing the provider URL updates the input value", async () => {
    await renderAI();
    const urlInput = screen.getByDisplayValue(DASHSCOPE_URL) as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: "https://example.com/v1" } });
    expect(urlInput.value).toBe("https://example.com/v1");
  });
});
