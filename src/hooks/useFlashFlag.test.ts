import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFlashFlag } from "./useFlashFlag";

describe("useFlashFlag", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts false", () => {
    const { result } = renderHook(() => useFlashFlag(1500));
    expect(result.current[0]).toBe(false);
  });

  it("flips true on flash()", () => {
    const { result } = renderHook(() => useFlashFlag(1500));
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
  });

  it("auto-resets to false after the delay", () => {
    const { result } = renderHook(() => useFlashFlag(1500));
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
    act(() => { vi.advanceTimersByTime(1500); });
    expect(result.current[0]).toBe(false);
  });

  it("does not reset before the delay elapses", () => {
    const { result } = renderHook(() => useFlashFlag(2000));
    act(() => result.current[1]());
    act(() => { vi.advanceTimersByTime(1999); });
    expect(result.current[0]).toBe(true);
  });

  it("re-arming extends the window (no early reset from a prior timer)", () => {
    const { result } = renderHook(() => useFlashFlag(1000));
    act(() => result.current[1]());
    act(() => { vi.advanceTimersByTime(800); });
    // flash again before the first timer fires
    act(() => result.current[1]());
    act(() => { vi.advanceTimersByTime(800); }); // 1600 total, but only 800 since re-arm
    expect(result.current[0]).toBe(true);
    act(() => { vi.advanceTimersByTime(200); });  // now 1000 since re-arm
    expect(result.current[0]).toBe(false);
  });

  it("clears the timer on unmount (no callback after teardown)", () => {
    const clearSpy = vi.spyOn(global, "clearTimeout");
    const { result, unmount } = renderHook(() => useFlashFlag(1500));
    act(() => result.current[1]());
    unmount();
    expect(clearSpy).toHaveBeenCalled();
    // advancing past the delay must not throw or warn
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
  });

  it("uses the default delay of 1500ms when none is given", () => {
    const { result } = renderHook(() => useFlashFlag());
    act(() => result.current[1]());
    act(() => { vi.advanceTimersByTime(1499); });
    expect(result.current[0]).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current[0]).toBe(false);
  });
});
