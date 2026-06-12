import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAutoSync } from "./useAutoSync";
import { useGistStore } from "../store/useGistStore";
import { useThemeStore } from "../store/useThemeStore";

const MIN = 60 * 1000;

describe("useAutoSync", () => {
  let syncMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    syncMock = vi.fn().mockResolvedValue(undefined);
    // Inject a mock sync action; the hook reads it via the store selector.
    useGistStore.setState({
      sync: syncMock as never,
      syncStatus: "idle",
      isAuthenticated: true,
    });
    useThemeStore.setState({ autoSyncMinutes: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing when autoSyncMinutes is 0", () => {
    renderHook(() => useAutoSync());
    act(() => vi.advanceTimersByTime(60 * MIN));
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("fires an incremental sync on every interval tick", () => {
    useThemeStore.setState({ autoSyncMinutes: 5 });
    renderHook(() => useAutoSync());

    act(() => vi.advanceTimersByTime(5 * MIN));
    expect(syncMock).toHaveBeenCalledTimes(1);
    expect(syncMock).toHaveBeenCalledWith(false); // incremental, never full

    act(() => vi.advanceTimersByTime(5 * MIN));
    expect(syncMock).toHaveBeenCalledTimes(2);
  });

  it("does not fire before the interval elapses", () => {
    useThemeStore.setState({ autoSyncMinutes: 5 });
    renderHook(() => useAutoSync());
    act(() => vi.advanceTimersByTime(5 * MIN - 1));
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("skips the tick when not authenticated", () => {
    useGistStore.setState({ isAuthenticated: false });
    useThemeStore.setState({ autoSyncMinutes: 1 });
    renderHook(() => useAutoSync());
    act(() => vi.advanceTimersByTime(3 * MIN));
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("skips the tick while a sync is already running", () => {
    useGistStore.setState({ syncStatus: "syncing" });
    useThemeStore.setState({ autoSyncMinutes: 1 });
    renderHook(() => useAutoSync());
    act(() => vi.advanceTimersByTime(MIN));
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("resumes after a running sync finishes (refs see fresh state)", () => {
    useGistStore.setState({ syncStatus: "syncing" });
    useThemeStore.setState({ autoSyncMinutes: 1 });
    renderHook(() => useAutoSync());

    act(() => vi.advanceTimersByTime(MIN)); // skipped
    expect(syncMock).not.toHaveBeenCalled();

    act(() => useGistStore.setState({ syncStatus: "idle" }));
    act(() => vi.advanceTimersByTime(MIN)); // now fires
    expect(syncMock).toHaveBeenCalledTimes(1);
  });

  it("restarts the interval when the setting changes", () => {
    useThemeStore.setState({ autoSyncMinutes: 10 });
    renderHook(() => useAutoSync());

    act(() => vi.advanceTimersByTime(9 * MIN)); // not yet due on the 10-min clock
    expect(syncMock).not.toHaveBeenCalled();

    act(() => useThemeStore.setState({ autoSyncMinutes: 2 })); // old timer discarded
    act(() => vi.advanceTimersByTime(2 * MIN));
    expect(syncMock).toHaveBeenCalledTimes(1);
  });

  it("turning the setting off cancels the pending interval", () => {
    useThemeStore.setState({ autoSyncMinutes: 1 });
    renderHook(() => useAutoSync());
    act(() => useThemeStore.setState({ autoSyncMinutes: 0 }));
    act(() => vi.advanceTimersByTime(10 * MIN));
    expect(syncMock).not.toHaveBeenCalled();
  });

  it("unmount stops the interval", () => {
    useThemeStore.setState({ autoSyncMinutes: 1 });
    const { unmount } = renderHook(() => useAutoSync());
    unmount();
    act(() => vi.advanceTimersByTime(5 * MIN));
    expect(syncMock).not.toHaveBeenCalled();
  });
});
