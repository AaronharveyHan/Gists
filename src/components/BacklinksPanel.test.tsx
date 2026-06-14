import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { BacklinksPanel } from "./BacklinksPanel";
import { useI18nStore } from "../store/useI18nStore";
import * as api from "../api/tauri";
import type { Gist } from "../api/tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../api/tauri");

function makeGist(over: Partial<Gist> = {}): Gist {
  return {
    id: "g1", description: "Linker gist", public: true, html_url: "",
    created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-01T00:00:00Z",
    files: [{ filename: "a.md", language: "Markdown", content: "x", size: 1, raw_url: null }],
    ...over,
  };
}

function renderPanel(links: Gist[] = [], props: Partial<React.ComponentProps<typeof BacklinksPanel>> = {}) {
  vi.mocked(api.getBacklinks).mockResolvedValue(links);
  const onOpen = vi.fn();
  const onClose = vi.fn();
  render(<BacklinksPanel gistId="target" gistName="My Target" onOpen={onOpen} onClose={onClose} {...props} />);
  return { onOpen, onClose };
}

describe("BacklinksPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
  });
  afterEach(() => cleanup());

  it("renders the panel title", async () => {
    renderPanel([]);
    expect(screen.getByText("Backlinks")).toBeTruthy();
  });

  it("queries backlinks for the gist id", async () => {
    renderPanel([]);
    await waitFor(() => expect(api.getBacklinks).toHaveBeenCalledWith("target"));
  });

  it("shows the empty state with a hint when there are no backlinks", async () => {
    renderPanel([]);
    await waitFor(() => expect(screen.getByText("No backlinks yet")).toBeTruthy());
    expect(screen.getByText(/\[\[My Target\]\]/)).toBeTruthy();
  });

  it("renders backlink items and a count", async () => {
    renderPanel([
      makeGist({ id: "a", description: "Alpha note" }),
      makeGist({ id: "b", description: "Beta note" }),
    ]);
    await waitFor(() => expect(screen.getByText("Alpha note")).toBeTruthy());
    expect(screen.getByText("Beta note")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("clicking a backlink calls onOpen with its id", async () => {
    const { onOpen } = renderPanel([makeGist({ id: "linked", description: "Linked gist" })]);
    await waitFor(() => expect(screen.getByText("Linked gist")).toBeTruthy());
    fireEvent.click(screen.getByText("Linked gist"));
    expect(onOpen).toHaveBeenCalledWith("linked");
  });

  it("the close button calls onClose", async () => {
    const { onClose } = renderPanel([]);
    fireEvent.click(screen.getByTitle("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("falls back to filename when a backlink has no description", async () => {
    renderPanel([makeGist({ id: "nf", description: "", files: [{ filename: "notes.md", language: "Markdown", content: "x", size: 1, raw_url: null }] })]);
    await waitFor(() => expect(screen.getByText("notes.md")).toBeTruthy());
  });
});
