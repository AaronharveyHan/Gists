import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import { AISelectionModal } from "./AISelectionModal";
import type { AIAction } from "./AISelectionModal";
import { useI18nStore } from "../store/useI18nStore";
import * as api from "../api/tauri";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../api/tauri");
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn().mockResolvedValue(undefined),
}));

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

/** Flush pending microtasks (getAiConfig + listen promises). */
async function flush() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderModal(props: Partial<React.ComponentProps<typeof AISelectionModal>> = {}) {
  const onReplace = vi.fn();
  const onInsertBelow = vi.fn();
  const onClose = vi.fn();
  render(
    <AISelectionModal
      action={(props.action ?? "rewrite") as AIAction}
      code={props.code ?? "print(1)"}
      language={props.language ?? "python"}
      onReplace={onReplace}
      onInsertBelow={onInsertBelow}
      onClose={onClose}
      {...props}
    />,
  );
  return { onReplace, onInsertBelow, onClose };
}

describe("AISelectionModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
    // Default: AI is configured so rewrite/tests auto-start.
    vi.mocked(api.getAiConfig).mockResolvedValue({
      base_url: "https://x", model: "m", embedding_model: "e",
      embedding_base_url: "", has_key: true,
    } as never);
    vi.mocked(api.aiChat).mockResolvedValue(undefined);
    for (const k of Object.keys(eventHandlers)) delete eventHandlers[k];
  });
  afterEach(() => cleanup());

  it("renders the action title for rewrite", async () => {
    renderModal({ action: "rewrite" });
    await flush();
    expect(screen.getByText("AI: Rewrite / Improve")).toBeTruthy();
  });

  it("shows the not-configured error when has_key is false", async () => {
    vi.mocked(api.getAiConfig).mockResolvedValue({
      base_url: "", model: "", embedding_model: "", embedding_base_url: "", has_key: false,
    } as never);
    renderModal({ action: "rewrite" });
    await flush();
    expect(screen.getByText("Configure an AI provider in Settings first.")).toBeTruthy();
    expect(api.aiChat).not.toHaveBeenCalled();
  });

  it("auto-starts the chat for the rewrite action on mount", async () => {
    renderModal({ action: "rewrite" });
    await flush();
    expect(api.aiChat).toHaveBeenCalled();
  });

  it("does NOT auto-start for the translate action", async () => {
    renderModal({ action: "translate" });
    await flush();
    expect(api.aiChat).not.toHaveBeenCalled();
  });

  it("shows the translate language bar for the translate action", async () => {
    renderModal({ action: "translate" });
    await flush();
    expect(screen.getByText("Translate to")).toBeTruthy();
    expect(screen.getByText("Translate")).toBeTruthy();
  });

  it("clicking Translate starts the chat", async () => {
    renderModal({ action: "translate" });
    await flush();
    await act(async () => {
      fireEvent.click(screen.getByText("Translate"));
    });
    await flush();
    expect(api.aiChat).toHaveBeenCalled();
  });

  it("shows the streaming cursor while waiting for ai-done", async () => {
    renderModal({ action: "rewrite" });
    await flush();
    expect(document.querySelector(".ai-cursor")).not.toBeNull();
  });

  it("updates the output as ai-chunk events arrive", async () => {
    renderModal({ action: "rewrite" });
    await flush();
    await act(async () => { fireIpcEvent("ai-chunk-", "Hello output"); });
    expect(screen.getByText("Hello output")).toBeTruthy();
  });

  it("enables apply buttons after ai-done", async () => {
    renderModal({ action: "rewrite" });
    await flush();
    await act(async () => { fireIpcEvent("ai-chunk-", "result code"); });
    await act(async () => { fireIpcEvent("ai-done-", {}); });
    const replace = screen.getByText("Replace selection") as HTMLButtonElement;
    await waitFor(() => expect(replace.disabled).toBe(false));
  });

  it("Replace selection calls onReplace with the extracted code and closes", async () => {
    const { onReplace, onClose } = renderModal({ action: "rewrite" });
    await flush();
    await act(async () => { fireIpcEvent("ai-chunk-", "```python\nprint(2)\n```"); });
    await act(async () => { fireIpcEvent("ai-done-", {}); });
    await act(async () => { fireEvent.click(screen.getByText("Replace selection")); });
    expect(onReplace).toHaveBeenCalledWith("print(2)");
    expect(onClose).toHaveBeenCalled();
  });

  it("Insert below calls onInsertBelow and closes", async () => {
    const { onInsertBelow, onClose } = renderModal({ action: "rewrite" });
    await flush();
    await act(async () => { fireIpcEvent("ai-chunk-", "plain result"); });
    await act(async () => { fireIpcEvent("ai-done-", {}); });
    await act(async () => { fireEvent.click(screen.getByText("Insert below")); });
    expect(onInsertBelow).toHaveBeenCalledWith("plain result");
    expect(onClose).toHaveBeenCalled();
  });

  it("Copy writes the result to the clipboard", async () => {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    renderModal({ action: "rewrite" });
    await flush();
    await act(async () => { fireIpcEvent("ai-chunk-", "copy me"); });
    await act(async () => { fireIpcEvent("ai-done-", {}); });
    await act(async () => { fireEvent.click(screen.getByText("Copy")); });
    expect(writeText).toHaveBeenCalledWith("copy me");
  });

  it("Escape key closes the modal", async () => {
    const { onClose } = renderModal({ action: "rewrite" });
    await flush();
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("close (×) button calls onClose", async () => {
    const { onClose } = renderModal({ action: "rewrite" });
    await flush();
    fireEvent.click(screen.getByText("×"));
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking the overlay backdrop closes the modal", async () => {
    const { onClose } = renderModal({ action: "rewrite" });
    await flush();
    const overlay = document.querySelector(".modal-overlay") as HTMLElement;
    fireEvent.mouseDown(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it("apply buttons stay disabled before ai-done fires", async () => {
    renderModal({ action: "rewrite" });
    await flush();
    await act(async () => { fireIpcEvent("ai-chunk-", "partial"); });
    const replace = screen.getByText("Replace selection") as HTMLButtonElement;
    expect(replace.disabled).toBe(true);
  });
});
