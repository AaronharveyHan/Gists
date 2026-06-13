import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { VscodeSnippetsImportModal } from "./VscodeSnippetsImportModal";
import { useI18nStore } from "../store/useI18nStore";
import * as api from "../api/tauri";
import type { VscodeSnippet } from "../api/tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../api/tauri");

function makeSnippet(overrides: Partial<VscodeSnippet> = {}): VscodeSnippet {
  return {
    name: "Log",
    description: "console log",
    prefix: "log",
    language: "javascript",
    filename: "javascript.json",
    body: "console.log($1)",
    source: "user",
    ...overrides,
  };
}

describe("VscodeSnippetsImportModal", () => {
  let onClose: ReturnType<typeof vi.fn>;
  let onImported: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
    onClose = vi.fn();
    onImported = vi.fn();
    // Default: no auto-detected path (mock resets cleared but impl preserved;
    // set explicitly to be safe across tests that override it).
    vi.mocked(api.vscodeSnippetsDefaultPath).mockResolvedValue(null);
    vi.mocked(api.vscodeSnippetsPreview).mockResolvedValue([]);
    vi.mocked(api.vscodeSnippetsImport).mockResolvedValue(0);
  });

  afterEach(() => cleanup());

  it("renders the modal title", async () => {
    render(<VscodeSnippetsImportModal onClose={onClose} onImported={onImported} />);
    expect(await screen.findByText("Import VS Code Snippets")).toBeTruthy();
  });

  it("shows auto-detect-failed message when no default path", async () => {
    render(<VscodeSnippetsImportModal onClose={onClose} onImported={onImported} />);
    expect(await screen.findByText(/Could not auto-detect/i)).toBeTruthy();
  });

  it("lists snippets loaded from the default path", async () => {
    vi.mocked(api.vscodeSnippetsDefaultPath).mockResolvedValue("/snips");
    vi.mocked(api.vscodeSnippetsPreview).mockResolvedValue([
      makeSnippet({ name: "Log" }),
      makeSnippet({ name: "ForEach", prefix: "forEach" }),
    ]);
    render(<VscodeSnippetsImportModal onClose={onClose} onImported={onImported} />);
    expect(await screen.findByText("Log")).toBeTruthy();
    expect(screen.getByText("ForEach")).toBeTruthy();
  });

  it("shows no-snippets message when the folder has none", async () => {
    vi.mocked(api.vscodeSnippetsDefaultPath).mockResolvedValue("/empty");
    vi.mocked(api.vscodeSnippetsPreview).mockResolvedValue([]);
    render(<VscodeSnippetsImportModal onClose={onClose} onImported={onImported} />);
    expect(await screen.findByText(/No snippets found in \/empty/)).toBeTruthy();
  });

  it("pre-selects all snippets and reflects the count", async () => {
    vi.mocked(api.vscodeSnippetsDefaultPath).mockResolvedValue("/snips");
    vi.mocked(api.vscodeSnippetsPreview).mockResolvedValue([
      makeSnippet({ name: "A" }),
      makeSnippet({ name: "B" }),
    ]);
    render(<VscodeSnippetsImportModal onClose={onClose} onImported={onImported} />);
    await screen.findByText("A");
    expect(screen.getByText("2 / 2 selected")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Import 2 as templates/ })).toBeTruthy();
  });

  it("toggling a snippet checkbox updates the selection count", async () => {
    vi.mocked(api.vscodeSnippetsDefaultPath).mockResolvedValue("/snips");
    vi.mocked(api.vscodeSnippetsPreview).mockResolvedValue([
      makeSnippet({ name: "A" }),
      makeSnippet({ name: "B" }),
    ]);
    render(<VscodeSnippetsImportModal onClose={onClose} onImported={onImported} />);
    await screen.findByText("A");
    // checkbox[0] is the select-all toggle; [1] is the first snippet row.
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]);
    expect(screen.getByText("1 / 2 selected")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Import 1 as templates/ })).toBeTruthy();
  });

  it("filters the list by the search box", async () => {
    vi.mocked(api.vscodeSnippetsDefaultPath).mockResolvedValue("/snips");
    vi.mocked(api.vscodeSnippetsPreview).mockResolvedValue([
      makeSnippet({ name: "Logger", prefix: "log" }),
      makeSnippet({ name: "ForEach", prefix: "forEach" }),
    ]);
    render(<VscodeSnippetsImportModal onClose={onClose} onImported={onImported} />);
    await screen.findByText("Logger");
    fireEvent.change(screen.getByPlaceholderText(/Filter by name/), {
      target: { value: "forEach" },
    });
    expect(screen.getByText("ForEach")).toBeTruthy();
    expect(screen.queryByText("Logger")).toBeNull();
  });

  it("import calls the API with selected snippets then onImported + onClose", async () => {
    vi.mocked(api.vscodeSnippetsDefaultPath).mockResolvedValue("/snips");
    vi.mocked(api.vscodeSnippetsPreview).mockResolvedValue([
      makeSnippet({ name: "A" }),
      makeSnippet({ name: "B" }),
    ]);
    vi.mocked(api.vscodeSnippetsImport).mockResolvedValue(2);
    render(<VscodeSnippetsImportModal onClose={onClose} onImported={onImported} />);
    await screen.findByText("A");
    fireEvent.click(screen.getByRole("button", { name: /Import 2 as templates/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onImported).toHaveBeenCalledOnce();
    const items = vi.mocked(api.vscodeSnippetsImport).mock.calls[0][0];
    expect(items).toHaveLength(2);
  });

  it("Escape calls onClose", async () => {
    render(<VscodeSnippetsImportModal onClose={onClose} onImported={onImported} />);
    await screen.findByText("Import VS Code Snippets");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clicking the × close button calls onClose", async () => {
    render(<VscodeSnippetsImportModal onClose={onClose} onImported={onImported} />);
    await screen.findByText("Import VS Code Snippets");
    fireEvent.click(screen.getByText("×"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
