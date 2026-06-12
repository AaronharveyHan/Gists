import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useUpdateCheck } from "./useUpdateCheck";

const checkMock = vi.fn();
const relaunchMock = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: (...args: unknown[]) => checkMock(...args),
}));
vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: (...args: unknown[]) => relaunchMock(...args),
}));

describe("useUpdateCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null while no update is available", async () => {
    checkMock.mockResolvedValue({ available: false });
    const { result } = renderHook(() => useUpdateCheck());

    await waitFor(() => expect(checkMock).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("returns null when the updater returns nothing (disabled/offline)", async () => {
    checkMock.mockResolvedValue(null);
    const { result } = renderHook(() => useUpdateCheck());

    await waitFor(() => expect(checkMock).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("stays null when the check rejects (silently ignored)", async () => {
    checkMock.mockRejectedValue(new Error("no network"));
    const { result } = renderHook(() => useUpdateCheck());

    await waitFor(() => expect(checkMock).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("ignores an 'available' update that has no version string", async () => {
    checkMock.mockResolvedValue({ available: true, version: "" });
    const { result } = renderHook(() => useUpdateCheck());

    await waitFor(() => expect(checkMock).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("exposes the version when an update is available", async () => {
    checkMock.mockResolvedValue({
      available: true,
      version: "0.3.0",
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    });
    const { result } = renderHook(() => useUpdateCheck());

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.version).toBe("0.3.0");
  });

  it("install() downloads, installs, then relaunches the app", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    checkMock.mockResolvedValue({ available: true, version: "0.3.0", downloadAndInstall });
    relaunchMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useUpdateCheck());

    await waitFor(() => expect(result.current).not.toBeNull());
    await result.current!.install();

    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(relaunchMock).toHaveBeenCalledTimes(1);
    // Relaunch must happen after the install completes.
    expect(downloadAndInstall.mock.invocationCallOrder[0]).toBeLessThan(
      relaunchMock.mock.invocationCallOrder[0]
    );
  });
});
