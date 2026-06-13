import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { ImportModal } from "./ImportModal";
import { useGistStore } from "../store/useGistStore";
import { useI18nStore } from "../store/useI18nStore";
import * as tauriApi from "../api/tauri";
import type { ImportPreviewItem } from "../api/tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../api/tauri");

function previewItem(id: string, filename: string, status: "new" | "exists"): ImportPreviewItem {
  return {
    id,
    description: "",
    file_count: 1,
    primary_filename: filename,
    public: false,
    pinned: false,
    tags: [],
    status,
  };
}

describe("ImportModal", () => {
  beforeEach(() => {
    useI18nStore.setState({ lang: "en" });
    vi.clearAllMocks();
    vi.mocked(tauriApi.importPreview).mockResolvedValue([]);
    vi.mocked(tauriApi.importExecute).mockResolvedValue(0);
    useGistStore.setState({ sync: vi.fn().mockResolvedValue(undefined) });
  });
  afterEach(() => cleanup());

  it("shows loading indicator immediately on mount", () => {
    render(<ImportModal filePath="/backup.json" onClose={vi.fn()} />);
    expect(screen.getByText("Reading backup file...")).toBeTruthy();
  });

  it("shows preview list after importPreview resolves", async () => {
    vi.mocked(tauriApi.importPreview).mockResolvedValue([
      previewItem("g1", "notes.md", "new"),
      previewItem("g2", "app.ts", "exists"),
    ]);
    render(<ImportModal filePath="/backup.json" onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("notes.md")).toBeTruthy();
      expect(screen.getByText("app.ts")).toBeTruthy();
    });
  });

  it("pre-selects new items but not existing ones", async () => {
    vi.mocked(tauriApi.importPreview).mockResolvedValue([
      previewItem("g1", "notes.md", "new"),
      previewItem("g2", "app.ts", "exists"),
    ]);
    render(<ImportModal filePath="/backup.json" onClose={vi.fn()} />);
    await waitFor(() => screen.getByText("notes.md"));

    // checkboxes: [select-all, g1 (new), g2 (exists)]
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes[1].checked).toBe(true);  // g1 new → pre-selected
    expect(checkboxes[2].checked).toBe(false); // g2 exists → not selected
  });

  it("import button is disabled when no items are selected", async () => {
    vi.mocked(tauriApi.importPreview).mockResolvedValue([
      previewItem("g1", "notes.md", "exists"), // exists → not pre-selected
    ]);
    render(<ImportModal filePath="/backup.json" onClose={vi.fn()} />);
    await waitFor(() => screen.getByText("notes.md"));
    const btn = screen.getByRole("button", { name: /Import 0/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("import button is enabled when items are selected", async () => {
    vi.mocked(tauriApi.importPreview).mockResolvedValue([
      previewItem("g1", "main.ts", "new"),
    ]);
    render(<ImportModal filePath="/backup.json" onClose={vi.fn()} />);
    await waitFor(() => screen.getByText("main.ts"));
    const btn = screen.getByRole("button", { name: /Import 1/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("calls importExecute with selected IDs on import", async () => {
    vi.mocked(tauriApi.importPreview).mockResolvedValue([
      previewItem("g1", "main.ts", "new"),
    ]);
    vi.mocked(tauriApi.importExecute).mockResolvedValue(1);
    render(<ImportModal filePath="/backup.json" onClose={vi.fn()} />);
    await waitFor(() => screen.getByText("main.ts"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Import 1/ }));
    });
    expect(vi.mocked(tauriApi.importExecute)).toHaveBeenCalledWith("/backup.json", ["g1"]);
  });

  it("shows done screen after successful import", async () => {
    vi.mocked(tauriApi.importPreview).mockResolvedValue([
      previewItem("g1", "main.ts", "new"),
    ]);
    vi.mocked(tauriApi.importExecute).mockResolvedValue(1);
    render(<ImportModal filePath="/backup.json" onClose={vi.fn()} />);
    await waitFor(() => screen.getByText("main.ts"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Import 1/ }));
    });
    await waitFor(() => {
      expect(screen.getByText(/Successfully imported 1 gist/)).toBeTruthy();
    });
  });

  it("shows error phase when importPreview rejects", async () => {
    vi.mocked(tauriApi.importPreview).mockRejectedValue(new Error("parse error"));
    render(<ImportModal filePath="/backup.json" onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText("Failed to process backup file:")).toBeTruthy();
    });
  });

  it("Escape key calls onClose", () => {
    const onClose = vi.fn();
    render(<ImportModal filePath="/backup.json" onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("overlay mousedown calls onClose", () => {
    const onClose = vi.fn();
    const { container } = render(<ImportModal filePath="/backup.json" onClose={onClose} />);
    const overlay = container.querySelector(".modal-overlay") as HTMLElement;
    fireEvent.mouseDown(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
