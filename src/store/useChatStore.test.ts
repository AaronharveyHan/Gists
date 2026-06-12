import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore } from "./useChatStore";
import type { ChatMsg } from "./useChatStore";

const msg = (content: string, role: ChatMsg["role"] = "user"): ChatMsg => ({
  role,
  content,
});

describe("useChatStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useChatStore.setState({ history: {} });
  });

  it("setHistory() stores messages keyed by gistId", () => {
    useChatStore.getState().setHistory("g1", [msg("hi")]);
    expect(useChatStore.getState().history["g1"]).toHaveLength(1);
    expect(useChatStore.getState().history["g1"][0].content).toBe("hi");
  });

  it("setHistory() preserves messages from other gists", () => {
    useChatStore.getState().setHistory("g1", [msg("a")]);
    useChatStore.getState().setHistory("g2", [msg("b")]);
    expect(useChatStore.getState().history["g1"]).toBeDefined();
    expect(useChatStore.getState().history["g2"]).toBeDefined();
  });

  it("setHistory() trims to the last 60 messages", () => {
    const msgs = Array.from({ length: 80 }, (_, i) => msg(String(i)));
    useChatStore.getState().setHistory("g1", msgs);
    const stored = useChatStore.getState().history["g1"];
    expect(stored).toHaveLength(60);
    expect(stored[0].content).toBe("20"); // keeps msgs[20..79]
    expect(stored[59].content).toBe("79");
  });

  it("setHistory() evicts the oldest gist when over 20 gists are stored", () => {
    for (let i = 0; i < 20; i++) {
      useChatStore.getState().setHistory(`g${i}`, [msg("x")]);
    }
    // 21st gist — g0 should be evicted (it was inserted first)
    useChatStore.getState().setHistory("g20", [msg("new")]);
    expect(useChatStore.getState().history["g0"]).toBeUndefined();
    expect(useChatStore.getState().history["g20"]).toBeDefined();
  });

  it("clearHistory() removes history for a single gist", () => {
    useChatStore.getState().setHistory("g1", [msg("hi")]);
    useChatStore.getState().setHistory("g2", [msg("hey")]);
    useChatStore.getState().clearHistory("g1");
    expect(useChatStore.getState().history["g1"]).toBeUndefined();
    expect(useChatStore.getState().history["g2"]).toBeDefined();
  });

  it("clearHistory() is a no-op for an unknown gistId", () => {
    useChatStore.getState().setHistory("g1", [msg("hi")]);
    useChatStore.getState().clearHistory("nope");
    expect(useChatStore.getState().history["g1"]).toBeDefined();
  });
});
