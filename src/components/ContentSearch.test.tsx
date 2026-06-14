import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import { ContentSearch } from "./ContentSearch";
import { useGistStore } from "../store/useGistStore";
import { useI18nStore } from "../store/useI18nStore";
import * as api from "../api/tauri";
import type { Gist } from "../api/tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../api/tauri");

Element.prototype.scrollIntoView = vi.fn();

const selectGist = vi.fn();

function makeGist(id: string, filename: string, content: string): Gist {
  return {
    id, description: id, public: true, html_url: "",
    created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-01T00:00:00Z",
    files: [{ filename, language: "TypeScript", content, size: content.length, raw_url: null }],
  };
}

function renderSearch(gists: Gist[] = []) {
  vi.mocked(api.listGists).mockResolvedValue(gists);
  const onClose = vi.fn();
  render(<ContentSearch onClose={onClose} />);
  return { onClose };
}

async function flush() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("ContentSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
    useGistStore.setState({ selectGist } as never);
  });
  afterEach(() => cleanup());

  it("loads all gists on mount", async () => {
    renderSearch([]);
    await waitFor(() => expect(api.listGists).toHaveBeenCalled());
  });

  it("renders the search input", async () => {
    renderSearch([]);
    await flush();
    expect(screen.getByPlaceholderText("Search in files...")).toBeTruthy();
  });

  it("finds matching lines and groups them by file", async () => {
    renderSearch([makeGist("g1", "app.ts", "const foo = 1;\nconst bar = 2;\nfoo();")]);
    await flush();
    fireEvent.change(screen.getByPlaceholderText("Search in files..."), { target: { value: "foo" } });
    await waitFor(() => expect(screen.getByText("app.ts")).toBeTruthy());
    // two lines contain "foo"
    expect(document.querySelectorAll(".content-search__hit").length).toBe(2);
  });

  it("highlights the matched substring", async () => {
    renderSearch([makeGist("g1", "a.ts", "hello world")]);
    await flush();
    fireEvent.change(screen.getByPlaceholderText("Search in files..."), { target: { value: "world" } });
    await waitFor(() => {
      const mark = document.querySelector(".content-search__match") as HTMLElement;
      expect(mark.textContent).toBe("world");
    });
  });

  it("shows the no-results message for a query with no hits", async () => {
    renderSearch([makeGist("g1", "a.ts", "nothing here")]);
    await flush();
    fireEvent.change(screen.getByPlaceholderText("Search in files..."), { target: { value: "zzz" } });
    await waitFor(() => expect(screen.getByText("No results found")).toBeTruthy());
  });

  it("clicking a hit selects the gist and closes", async () => {
    const { onClose } = renderSearch([makeGist("gHit", "a.ts", "match line")]);
    await flush();
    fireEvent.change(screen.getByPlaceholderText("Search in files..."), { target: { value: "match" } });
    await waitFor(() => expect(document.querySelector(".content-search__hit")).toBeTruthy());
    fireEvent.click(document.querySelector(".content-search__hit") as HTMLElement);
    expect(selectGist).toHaveBeenCalledWith("gHit");
    expect(onClose).toHaveBeenCalled();
  });

  it("Enter on the active hit navigates to it", async () => {
    const { onClose } = renderSearch([makeGist("gEnter", "a.ts", "enter target")]);
    await flush();
    const input = screen.getByPlaceholderText("Search in files...");
    fireEvent.change(input, { target: { value: "target" } });
    await waitFor(() => expect(document.querySelector(".content-search__hit")).toBeTruthy());
    fireEvent.keyDown(input, { key: "Enter" });
    expect(selectGist).toHaveBeenCalledWith("gEnter");
    expect(onClose).toHaveBeenCalled();
  });

  it("ArrowDown moves the active hit", async () => {
    renderSearch([makeGist("g1", "a.ts", "x foo\ny foo\nz foo")]);
    await flush();
    const input = screen.getByPlaceholderText("Search in files...");
    fireEvent.change(input, { target: { value: "foo" } });
    await waitFor(() => expect(document.querySelectorAll(".content-search__hit").length).toBe(3));
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const active = document.querySelector(".content-search__hit--active") as HTMLElement;
    expect(active.querySelector(".content-search__line-num")?.textContent).toBe("2");
  });

  it("Escape closes the panel", async () => {
    const { onClose } = renderSearch([]);
    await flush();
    fireEvent.keyDown(screen.getByPlaceholderText("Search in files..."), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("the close button calls onClose", async () => {
    const { onClose } = renderSearch([]);
    await flush();
    fireEvent.click(screen.getByTitle("Close (Esc)"));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the result count once a query is entered", async () => {
    renderSearch([makeGist("g1", "a.ts", "alpha\nalpha")]);
    await flush();
    fireEvent.change(screen.getByPlaceholderText("Search in files..."), { target: { value: "alpha" } });
    await waitFor(() => expect(screen.getByText("2 results")).toBeTruthy());
  });
});
