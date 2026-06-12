import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import * as api from "../api/tauri";
import { useAiInlineCompletion } from "./useAiInlineCompletion";

vi.mock("../api/tauri");
const mocked = vi.mocked(api);

// ── Fake Monaco surface ───────────────────────────────────────────────────────

class FakeRange {
  constructor(
    public startLine: number,
    public startCol: number,
    public endLine: number,
    public endCol: number
  ) {}
}

type Provider = {
  provideInlineCompletions: (
    model: unknown,
    position: unknown,
    ctx: unknown,
    token: unknown
  ) => Promise<{ items: Array<{ insertText: string; range: FakeRange }> }>;
};

function makeMonaco() {
  const dispose = vi.fn();
  let provider: Provider | null = null;
  const monaco = {
    languages: {
      registerInlineCompletionsProvider: vi.fn((_lang: string, p: Provider) => {
        provider = p;
        return { dispose };
      }),
    },
    Range: FakeRange,
  };
  return { monaco, dispose, getProvider: () => provider };
}

function makeModel(text: string, offset = text.length, lang = "python") {
  return {
    getValue: () => text,
    getOffsetAt: () => offset,
    getLanguageId: () => lang,
  };
}

function makeToken() {
  let cancelCb: (() => void) | null = null;
  const token = {
    isCancellationRequested: false,
    onCancellationRequested: (cb: () => void) => {
      cancelCb = cb;
    },
  };
  return { token, cancel: () => cancelCb?.() };
}

const POSITION = { lineNumber: 3, column: 7 };

function renderCompletion(monaco: unknown, enabled = true, ready = true) {
  const monacoRef = { current: monaco };
  return renderHook(
    ({ e, r }: { e: boolean; r: boolean }) => useAiInlineCompletion(monacoRef, e, r),
    { initialProps: { e: enabled, r: ready } }
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useAiInlineCompletion — provider lifecycle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registers a provider for all languages when ready and enabled", () => {
    const { monaco } = makeMonaco();
    renderCompletion(monaco);
    expect(monaco.languages.registerInlineCompletionsProvider).toHaveBeenCalledWith(
      "*",
      expect.any(Object)
    );
  });

  it("does not register when disabled", () => {
    const { monaco } = makeMonaco();
    renderCompletion(monaco, false, true);
    expect(monaco.languages.registerInlineCompletionsProvider).not.toHaveBeenCalled();
  });

  it("does not register before Monaco is ready", () => {
    const { monaco } = makeMonaco();
    renderCompletion(monaco, true, false);
    expect(monaco.languages.registerInlineCompletionsProvider).not.toHaveBeenCalled();
  });

  it("registers once ready flips to true", () => {
    const { monaco } = makeMonaco();
    const { rerender } = renderCompletion(monaco, true, false);
    rerender({ e: true, r: true });
    expect(monaco.languages.registerInlineCompletionsProvider).toHaveBeenCalledTimes(1);
  });

  it("disposes the provider on unmount", () => {
    const { monaco, dispose } = makeMonaco();
    const { unmount } = renderCompletion(monaco);
    unmount();
    expect(dispose).toHaveBeenCalled();
  });

  it("disposes when the feature is turned off", () => {
    const { monaco, dispose } = makeMonaco();
    const { rerender } = renderCompletion(monaco);
    rerender({ e: false, r: true });
    expect(dispose).toHaveBeenCalled();
  });
});

describe("useAiInlineCompletion — completion flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  async function invokeProvider(
    getProvider: () => Provider | null,
    model: unknown,
    token: unknown
  ) {
    const pending = getProvider()!.provideInlineCompletions(model, POSITION, {}, token);
    await vi.advanceTimersByTimeAsync(450); // ride past the debounce
    return pending;
  }

  it("returns ghost text anchored at the cursor on the happy path", async () => {
    mocked.getAiConfig.mockResolvedValue({
      base_url: "",
      model: "",
      has_key: true,
      embedding_model: "",
      embedding_base_url: "",
    });
    mocked.aiComplete.mockResolvedValue("return x + y");
    const { monaco, getProvider } = makeMonaco();
    renderCompletion(monaco);

    const { token } = makeToken();
    const result = await invokeProvider(getProvider, makeModel("def add(x, y):\n    "), token);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].insertText).toBe("return x + y");
    // Zero-width range at the cursor: ghost text inserts, replaces nothing.
    expect(result.items[0].range).toEqual(new FakeRange(3, 7, 3, 7));
    // The prompt declares the model's language.
    const messages = mocked.aiComplete.mock.calls[0][0];
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Language: python");
    expect(messages[1].content).toBe("def add(x, y):\n    ");
  });

  it("returns no items when the AI key is not configured", async () => {
    mocked.getAiConfig.mockResolvedValue({
      base_url: "",
      model: "",
      has_key: false,
      embedding_model: "",
      embedding_base_url: "",
    });
    const { monaco, getProvider } = makeMonaco();
    renderCompletion(monaco);

    const { token } = makeToken();
    const result = await invokeProvider(getProvider, makeModel("some code here"), token);

    expect(result.items).toEqual([]);
    expect(mocked.aiComplete).not.toHaveBeenCalled();
  });

  it("skips trivially short prefixes without calling the AI", async () => {
    mocked.getAiConfig.mockResolvedValue({
      base_url: "",
      model: "",
      has_key: true,
      embedding_model: "",
      embedding_base_url: "",
    });
    const { monaco, getProvider } = makeMonaco();
    renderCompletion(monaco);

    const { token } = makeToken();
    const result = await invokeProvider(getProvider, makeModel("  x  "), token);

    expect(result.items).toEqual([]);
    expect(mocked.aiComplete).not.toHaveBeenCalled();
  });

  it("cancellation during the debounce aborts without any API call", async () => {
    const { monaco, getProvider } = makeMonaco();
    renderCompletion(monaco);

    const { token, cancel } = makeToken();
    const pending = getProvider()!.provideInlineCompletions(
      makeModel("plenty of code"),
      POSITION,
      {},
      token
    );
    cancel(); // user kept typing → Monaco cancels the request mid-debounce
    const result = await pending;

    expect(result.items).toEqual([]);
    expect(mocked.getAiConfig).not.toHaveBeenCalled();
    expect(mocked.aiComplete).not.toHaveBeenCalled();
  });

  it("an aiComplete failure degrades to no items instead of throwing", async () => {
    mocked.getAiConfig.mockResolvedValue({
      base_url: "",
      model: "",
      has_key: true,
      embedding_model: "",
      embedding_base_url: "",
    });
    mocked.aiComplete.mockRejectedValue(new Error("rate limited"));
    const { monaco, getProvider } = makeMonaco();
    renderCompletion(monaco);

    const { token } = makeToken();
    const result = await invokeProvider(getProvider, makeModel("some real code"), token);

    expect(result.items).toEqual([]);
  });
});
