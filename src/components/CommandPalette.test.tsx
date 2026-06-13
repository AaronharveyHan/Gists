import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette";
import { useGistStore } from "../store/useGistStore";
import { useRecentStore } from "../store/useRecentStore";
import { useI18nStore } from "../store/useI18nStore";
import type { Gist, GistFile } from "../api/tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../api/tauri");

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

function makeFile(overrides: Partial<GistFile> = {}): GistFile {
  return { filename: "file.ts", language: null, content: "", size: 0, raw_url: null, ...overrides };
}

function makeGist(id: string, overrides: Partial<Gist> = {}): Gist {
  return {
    id,
    description: "",
    public: false,
    html_url: "",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    files: [makeFile({ filename: `${id}.ts` })],
    pending_push: false,
    local_only: false,
    category: "gist",
    ...overrides,
  };
}

const gistA = makeGist("a", {
  files: [makeFile({ filename: "alpha.ts" })],
  updated_at: "2024-03-01T00:00:00Z",
});
const gistB = makeGist("b", {
  files: [makeFile({ filename: "beta.ts" })],
  updated_at: "2024-02-01T00:00:00Z",
});
const gistC = makeGist("c", {
  files: [makeFile({ filename: "gamma.ts" })],
  updated_at: "2024-01-01T00:00:00Z",
});

describe("CommandPalette", () => {
  let selectGist: ReturnType<typeof vi.fn>;
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    selectGist = vi.fn();
    onClose = vi.fn();
    useI18nStore.setState({ lang: "en" });
    useRecentStore.setState({ ids: [] });
    useGistStore.setState({ gists: [gistA, gistB, gistC], selectGist } as never);
  });

  afterEach(() => cleanup());

  it("renders the search input", () => {
    render(<CommandPalette onClose={onClose} />);
    expect(screen.getByPlaceholderText("Jump to gist…")).toBeTruthy();
  });

  it("shows All Gists section header when no recents", () => {
    render(<CommandPalette onClose={onClose} />);
    expect(screen.getByText("All Gists")).toBeTruthy();
  });

  it("shows Recent section header when recentIds are present", () => {
    useRecentStore.setState({ ids: ["a"] });
    render(<CommandPalette onClose={onClose} />);
    expect(screen.getByText("Recent")).toBeTruthy();
    expect(screen.getByText("All Gists")).toBeTruthy();
  });

  it("lists gist filenames", () => {
    render(<CommandPalette onClose={onClose} />);
    expect(screen.getByText("alpha.ts")).toBeTruthy();
    expect(screen.getByText("beta.ts")).toBeTruthy();
    expect(screen.getByText("gamma.ts")).toBeTruthy();
  });

  it("shows empty state when there are no gists", () => {
    useGistStore.setState({ gists: [], selectGist } as never);
    render(<CommandPalette onClose={onClose} />);
    expect(screen.getByText("No gists yet")).toBeTruthy();
  });

  it("filters the list when a query is typed", () => {
    render(<CommandPalette onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText("Jump to gist…"), {
      target: { value: "alpha" },
    });
    // HighlightMatch splits the matched portion into a <mark>, so RTL's
    // getNodeText (direct text nodes only) won't see "alpha.ts" as a whole.
    // Check via role="option" count and textContent instead.
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("alpha");
    expect(screen.queryByText("beta.ts")).toBeNull();
    expect(screen.queryByText("gamma.ts")).toBeNull();
  });

  it("shows no-match message when query has no results", () => {
    render(<CommandPalette onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText("Jump to gist…"), {
      target: { value: "zzz_nomatch_zzz" },
    });
    expect(screen.getByText("No matching gists")).toBeTruthy();
  });

  it("Escape calls onClose", () => {
    render(<CommandPalette onClose={onClose} />);
    fireEvent.keyDown(screen.getByPlaceholderText("Jump to gist…"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Enter on the first item calls selectGist and onClose", () => {
    render(<CommandPalette onClose={onClose} />);
    // First item after sort by updated_at desc is alpha (2024-03-01)
    fireEvent.keyDown(screen.getByPlaceholderText("Jump to gist…"), { key: "Enter" });
    expect(selectGist).toHaveBeenCalledWith("a");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ArrowDown moves active highlight to the second item, Enter selects it", () => {
    render(<CommandPalette onClose={onClose} />);
    const input = screen.getByPlaceholderText("Jump to gist…");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    // Second item by updated_at desc is beta (2024-02-01)
    expect(selectGist).toHaveBeenCalledWith("b");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ArrowUp at index 0 stays at 0", () => {
    render(<CommandPalette onClose={onClose} />);
    const input = screen.getByPlaceholderText("Jump to gist…");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    // Should still select first item
    expect(selectGist).toHaveBeenCalledWith("a");
  });

  it("ArrowDown past last item stays at last item", () => {
    render(<CommandPalette onClose={onClose} />);
    const input = screen.getByPlaceholderText("Jump to gist…");
    // 3 items: press down 10 times
    for (let i = 0; i < 10; i++) {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    }
    fireEvent.keyDown(input, { key: "Enter" });
    // Last item by updated_at desc is gamma (2024-01-01)
    expect(selectGist).toHaveBeenCalledWith("c");
  });

  it("clicking overlay calls onClose", () => {
    render(<CommandPalette onClose={onClose} />);
    // The overlay is the modal-overlay div; clicking it (target === currentTarget) triggers close
    const overlay = document.querySelector(".palette-overlay") as HTMLElement;
    fireEvent.mouseDown(overlay);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clicking an item calls selectGist and onClose", () => {
    render(<CommandPalette onClose={onClose} />);
    const item = screen.getByText("beta.ts").closest("li") as HTMLElement;
    fireEvent.mouseDown(item);
    expect(selectGist).toHaveBeenCalledWith("b");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("navigation resets to 0 when query changes", () => {
    render(<CommandPalette onClose={onClose} />);
    const input = screen.getByPlaceholderText("Jump to gist…");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    // Change query — activeIdx resets
    fireEvent.change(input, { target: { value: "beta" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(selectGist).toHaveBeenCalledWith("b");
  });
});
