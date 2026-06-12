import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboard } from "./useKeyboard";

function fire(key: string, init: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, ...init }));
}

describe("useKeyboard", () => {
  it("fires handler on meta+key (metaKey)", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboard("k", "meta", handler));
    fire("k", { metaKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("accepts ctrlKey as a meta alternative", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboard("s", "meta", handler));
    fire("s", { ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not fire when the modifier is absent", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboard("k", "meta", handler));
    fire("k"); // no modifier
    expect(handler).not.toHaveBeenCalled();
  });

  it("meta modifier excludes shift", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboard("k", "meta", handler));
    fire("k", { metaKey: true, shiftKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it("fires handler on meta+shift+key", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboard("p", "meta+shift", handler));
    fire("p", { metaKey: true, shiftKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ctrl modifier requires ctrlKey only (not meta)", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboard("g", "ctrl", handler));
    fire("g", { ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("shift modifier fires correctly", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboard("Tab", "shift", handler));
    fire("Tab", { shiftKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("alt modifier fires correctly", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboard("Enter", "alt", handler));
    fire("Enter", { altKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("null modifier fires for any key without modifier requirements", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboard("x", null, handler));
    fire("x");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("key matching is case-insensitive", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboard("k", "meta", handler));
    fire("K", { metaKey: true }); // uppercase K
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not fire for a different key", () => {
    const handler = vi.fn();
    renderHook(() => useKeyboard("k", "meta", handler));
    fire("j", { metaKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it("removes the event listener on unmount", () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useKeyboard("k", "meta", handler));
    unmount();
    fire("k", { metaKey: true });
    expect(handler).not.toHaveBeenCalled();
  });
});
