import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebounce } from "./useDebounce";

describe("useDebounce", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not call fn before the delay elapses", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useDebounce(fn, 300));
    act(() => result.current("arg"));
    expect(fn).not.toHaveBeenCalled();
  });

  it("calls fn once after the delay", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useDebounce(fn, 300));
    act(() => {
      result.current("arg");
      vi.advanceTimersByTime(300);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("arg");
  });

  it("resets the timer on each invocation — fires only once on rapid calls", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useDebounce(fn, 300));
    act(() => {
      result.current("a");
      result.current("b");
      result.current("c");
      vi.advanceTimersByTime(300);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("c");
  });

  it("cancels the pending timer on unmount", () => {
    const fn = vi.fn();
    const { result, unmount } = renderHook(() => useDebounce(fn, 300));
    act(() => result.current("arg"));
    unmount();
    act(() => vi.advanceTimersByTime(300));
    expect(fn).not.toHaveBeenCalled();
  });

  it("passes multiple arguments to the underlying function", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useDebounce(fn, 100));
    act(() => {
      result.current(1, "hello", true);
      vi.advanceTimersByTime(100);
    });
    expect(fn).toHaveBeenCalledWith(1, "hello", true);
  });

  it("fires again after the delay when called a second time", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useDebounce(fn, 200));
    act(() => {
      result.current("first");
      vi.advanceTimersByTime(200);
    });
    act(() => {
      result.current("second");
      vi.advanceTimersByTime(200);
    });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, "first");
    expect(fn).toHaveBeenNthCalledWith(2, "second");
  });
});
