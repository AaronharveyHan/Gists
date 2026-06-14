import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StatusBar } from "./StatusBar";
import { useGistStore } from "../store/useGistStore";
import { useEditorUIStore } from "../store/useEditorUIStore";
import { useThemeStore } from "../store/useThemeStore";
import { useI18nStore } from "../store/useI18nStore";
import type { Gist } from "../api/tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../api/tauri");

function makeGist(over: Partial<Gist> = {}): Gist {
  return {
    id: "g1", description: "A gist", public: true, html_url: "",
    created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-01T00:00:00Z",
    files: [{ filename: "main.ts", language: "TypeScript", content: "x", size: 2048, raw_url: null }],
    ...over,
  };
}

function seed(gists: Gist[], selectedId: string | null, over: Record<string, unknown> = {}) {
  useGistStore.setState({ gists, selectedId, syncStatus: "idle", ...over } as never);
}

describe("StatusBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
    useEditorUIStore.setState({
      cursorLine: 1, cursorColumn: 1, selectedChars: 0, selectedLines: 0, activeFilename: null,
    } as never);
    useThemeStore.setState({ editorFontSize: 14 } as never);
    seed([], null);
  });
  afterEach(() => cleanup());

  it("shows the font size even with no gist selected", () => {
    render(<StatusBar />);
    expect(screen.getByText("14px")).toBeTruthy();
  });

  it("shows the total gists count when idle", () => {
    seed([makeGist({ id: "g1" }), makeGist({ id: "g2" })], null);
    render(<StatusBar />);
    expect(screen.getByText("2 gists")).toBeTruthy();
  });

  it("shows a syncing indicator while syncing", () => {
    seed([], null, { syncStatus: "syncing" });
    render(<StatusBar />);
    expect(screen.getByText("Syncing...")).toBeTruthy();
  });

  it("detects the language from the active filename", () => {
    seed([makeGist({ id: "g1" })], "g1");
    useEditorUIStore.setState({ activeFilename: "main.ts" } as never);
    render(<StatusBar />);
    expect(screen.getByText("TypeScript")).toBeTruthy();
  });

  it("shows encoding, line ending and file size for the selected gist", () => {
    seed([makeGist({ id: "g1" })], "g1");
    useEditorUIStore.setState({ activeFilename: "main.ts" } as never);
    render(<StatusBar />);
    expect(screen.getByText("UTF-8")).toBeTruthy();
    expect(screen.getByText("LF")).toBeTruthy();
    expect(screen.getByText("2.0 KB")).toBeTruthy();
  });

  it("shows the cursor line/column", () => {
    seed([makeGist({ id: "g1" })], "g1");
    useEditorUIStore.setState({ cursorLine: 12, cursorColumn: 5, activeFilename: "main.ts" } as never);
    render(<StatusBar />);
    expect(screen.getByText("Ln 12, Col 5")).toBeTruthy();
  });

  it("shows the selection count when text is selected", () => {
    seed([makeGist({ id: "g1" })], "g1");
    useEditorUIStore.setState({ selectedChars: 30, selectedLines: 3, activeFilename: "main.ts" } as never);
    render(<StatusBar />);
    expect(screen.getByText(/30 selected/)).toBeTruthy();
  });

  it("shows public/secret visibility for the selected gist", () => {
    seed([makeGist({ id: "g1", public: false })], "g1");
    render(<StatusBar />);
    expect(screen.getByText("Secret")).toBeTruthy();
  });

  it("shows the file count for the selected gist", () => {
    seed([makeGist({ id: "g1" })], "g1");
    render(<StatusBar />);
    expect(screen.getByText(/1 file/)).toBeTruthy();
  });
});
