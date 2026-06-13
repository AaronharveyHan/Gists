import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { AIPanel } from "./AIPanel";
import { useChatStore } from "../store/useChatStore";
import { useGistStore } from "../store/useGistStore";
import { useI18nStore } from "../store/useI18nStore";
import * as api from "../api/tauri";
import type { GistFile } from "../api/tauri";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../api/tauri");
vi.mock("./PromptLibrary", () => ({
  PromptLibrary: ({ onClose, onInsert }: { onClose: () => void; onInsert?: (t: string) => void }) => (
    <div data-testid="prompt-library">
      <button onClick={() => onInsert?.("inserted text")}>Insert</button>
      <button onClick={onClose}>Close Lib</button>
    </div>
  ),
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

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFile(overrides: Partial<GistFile> = {}): GistFile {
  return { filename: "main.ts", language: "TypeScript", content: "const x = 1;", size: 12, raw_url: null, ...overrides };
}

function renderPanel(props: Partial<React.ComponentProps<typeof AIPanel>> = {}) {
  const onClose = vi.fn();
  const onApplyDescription = vi.fn();
  render(
    <AIPanel
      gistId="g1"
      files={[makeFile()]}
      description="My gist"
      onApplyDescription={onApplyDescription}
      onClose={onClose}
      {...props}
    />,
  );
  return { onClose, onApplyDescription };
}

describe("AIPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
    useChatStore.setState({ history: {} } as never);
    useGistStore.setState({ createLocalGist: vi.fn().mockResolvedValue({ id: "new" }) } as never);
    // Reset captured event handlers
    for (const k of Object.keys(eventHandlers)) delete eventHandlers[k];
  });
  afterEach(() => cleanup());

  it("renders the panel title", () => {
    renderPanel();
    expect(screen.getByText("AI Assistant")).toBeTruthy();
  });

  it("renders the four preset chips", () => {
    renderPanel();
    expect(screen.getByText("Explain")).toBeTruthy();
    expect(screen.getByText("Optimize")).toBeTruthy();
    expect(screen.getByText("Tags")).toBeTruthy();
    expect(screen.getByText("Description")).toBeTruthy();
  });

  it("shows the empty state message when no conversation history", () => {
    renderPanel();
    expect(screen.getByText("Click an action above, or type a question below.")).toBeTruthy();
  });

  it("Send button is disabled when input is empty", () => {
    renderPanel();
    const btn = screen.getByText("Send") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("Send button enables when text is typed", () => {
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText(/Ask about this gist/), { target: { value: "hello" } });
    const btn = screen.getByText("Send") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("clicking Explain chip calls aiChat", async () => {
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByText("Explain"));
    });
    expect(api.aiChat).toHaveBeenCalled();
  });

  it("shows streaming indicator while waiting for ai-done", async () => {
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByText("Explain"));
    });
    // dots spinner or live cursor appears when streaming
    const dots = document.querySelector(".ai-dots") || document.querySelector(".ai-cursor");
    expect(dots).not.toBeNull();
  });

  it("appends assistant message after ai-done fires", async () => {
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByText("Explain"));
    });
    await act(async () => {
      fireIpcEvent("ai-done-", {});
    });
    // After done, streaming ends and message is in DOM
    const msgs = document.querySelectorAll(".ai-msg--assistant");
    expect(msgs.length).toBeGreaterThan(0);
  });

  it("shows live text when ai-chunk events fire", async () => {
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByText("Explain"));
    });
    await act(async () => {
      fireIpcEvent("ai-chunk-", "Hello from AI");
    });
    expect(screen.getByText("Hello from AI")).toBeTruthy();
  });

  it("Send button sends message via keyboard Enter", async () => {
    renderPanel();
    const textarea = screen.getByPlaceholderText(/Ask about this gist/);
    fireEvent.change(textarea, { target: { value: "What does this do?" } });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    });
    expect(api.aiChat).toHaveBeenCalled();
  });

  it("clear history button hidden when no messages", () => {
    renderPanel();
    expect(screen.queryByText("Clear history")).toBeNull();
  });

  it("clear history button appears after a message is set", () => {
    useChatStore.setState({ history: { g1: [{ role: "assistant", content: "Hello" }] } } as never);
    renderPanel();
    expect(screen.getByText("Clear history")).toBeTruthy();
  });

  it("Prompts chip shows PromptLibrary overlay", async () => {
    renderPanel();
    fireEvent.click(screen.getByText("Prompts"));
    expect(screen.getByTestId("prompt-library")).toBeTruthy();
  });

  it("PromptLibrary Insert injects text into the textarea", async () => {
    renderPanel();
    fireEvent.click(screen.getByText("Prompts"));
    fireEvent.click(screen.getByText("Insert"));
    const textarea = screen.getByPlaceholderText(/Ask about this gist/) as HTMLTextAreaElement;
    expect(textarea.value).toBe("inserted text");
  });

  it("close button calls onClose", () => {
    const { onClose } = renderPanel();
    fireEvent.click(screen.getByTitle("Close (⌘⇧A)"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("preset chips are disabled during streaming", async () => {
    renderPanel();
    await act(async () => {
      fireEvent.click(screen.getByText("Explain"));
    });
    const explain = screen.getByText("Explain") as HTMLButtonElement;
    expect(explain.disabled).toBe(true);
  });

  it("displays prior history from useChatStore on mount", () => {
    useChatStore.setState({
      history: { g1: [{ role: "assistant", content: "Prior answer" }] },
    } as never);
    renderPanel();
    expect(screen.getByText("Prior answer")).toBeTruthy();
  });
});
