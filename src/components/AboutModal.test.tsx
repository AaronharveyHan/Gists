import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { AboutModal } from "./AboutModal";
import { useI18nStore } from "../store/useI18nStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const getVersionMock = vi.fn();
const openMock = vi.fn();
const checkMock = vi.fn();
const relaunchMock = vi.fn();

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: (...a: unknown[]) => getVersionMock(...a),
}));
vi.mock("@tauri-apps/plugin-shell", () => ({
  open: (...a: unknown[]) => openMock(...a),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: (...a: unknown[]) => checkMock(...a),
}));
vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: (...a: unknown[]) => relaunchMock(...a),
}));

describe("AboutModal", () => {
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
    getVersionMock.mockResolvedValue("0.2.0");
    openMock.mockResolvedValue(undefined);
    onClose = vi.fn();
  });
  afterEach(() => cleanup());

  it("shows the app version once loaded", async () => {
    render(<AboutModal onClose={onClose} />);
    await waitFor(() => expect(screen.getByText("Version 0.2.0")).toBeTruthy());
  });

  it("Close button calls onClose", () => {
    render(<AboutModal onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Escape calls onClose", () => {
    render(<AboutModal onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("mousedown on the overlay closes, but not on the modal body", () => {
    const { container } = render(<AboutModal onClose={onClose} />);
    const overlay = container.querySelector(".modal-overlay") as HTMLElement;
    const body = container.querySelector(".modal") as HTMLElement;
    fireEvent.mouseDown(body);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(overlay);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("opens the GitHub repo, issues, and license links externally", async () => {
    render(<AboutModal onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "GitHub Repository" }));
    fireEvent.click(screen.getByRole("button", { name: "Report an Issue" }));
    fireEvent.click(screen.getByRole("button", { name: "License" }));
    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(3));
    expect(openMock).toHaveBeenCalledWith("https://github.com/AaronharveyHan/Gists");
    expect(openMock).toHaveBeenCalledWith("https://github.com/AaronharveyHan/Gists/issues");
    expect(openMock).toHaveBeenCalledWith("https://github.com/AaronharveyHan/Gists/blob/main/LICENSE");
  });

  it("reports up to date when no update is available", async () => {
    checkMock.mockResolvedValue({ available: false });
    render(<AboutModal onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Check for Updates" }));
    await waitFor(() => expect(screen.getByText("You're up to date.")).toBeTruthy());
  });

  it("shows an install button when an update is available, and installs + relaunches", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    checkMock.mockResolvedValue({ available: true, version: "0.3.0", downloadAndInstall });
    relaunchMock.mockResolvedValue(undefined);
    render(<AboutModal onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Check for Updates" }));

    const installBtn = await screen.findByRole("button", { name: /Version 0\.3\.0 is available\..*Install & Restart/ });
    fireEvent.click(installBtn);

    await waitFor(() => expect(relaunchMock).toHaveBeenCalledOnce());
    expect(downloadAndInstall).toHaveBeenCalledOnce();
  });

  it("shows an error message when the update check fails", async () => {
    checkMock.mockRejectedValue(new Error("offline"));
    render(<AboutModal onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Check for Updates" }));
    await waitFor(() => expect(screen.getByText("Couldn't check for updates.")).toBeTruthy());
  });
});
