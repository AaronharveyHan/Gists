import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { useRef } from "react";
import { SidebarGistList, languageColor } from "./SidebarGistList";
import type { SidebarGistListProps } from "./SidebarGistList";
import { useGistStore } from "../store/useGistStore";
import { useI18nStore } from "../store/useI18nStore";
import { translations } from "../i18n/translations";

const en = translations.en;
import type { Gist } from "../api/tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../api/tauri");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGist(overrides: Partial<Gist> = {}): Gist {
  return {
    id: "g1",
    description: "A gist",
    public: true,
    html_url: "",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-02T00:00:00Z",
    files: [{ filename: "main.ts", language: "TypeScript", content: "x", size: 1, raw_url: null }],
    ...overrides,
  };
}

const selectGist = vi.fn();
const togglePin = vi.fn();

/** Wrapper supplies the listRef (a real ref the virtualizer needs). */
function Harness(props: Partial<SidebarGistListProps>) {
  const listRef = useRef<HTMLDivElement>(null);
  const base: SidebarGistListProps = {
    listRef: listRef as React.RefObject<HTMLDivElement>,
    filteredGists: [],
    selectedId: null,
    selectMode: false,
    checkedIds: new Set(),
    toggleCheck: vi.fn(),
    openCtxMenu: vi.fn(),
    gists: [],
    syncStatus: "idle",
    isLocallyFiltered: false,
    searchQuery: "",
    searchMode: "keyword",
    semanticError: null,
    semanticBusy: false,
    semanticGists: [],
    semanticScoreMap: new Map(),
    t: en,
    ...props,
  };
  return <SidebarGistList {...base} />;
}

function renderList(props: Partial<SidebarGistListProps> = {}) {
  return render(<Harness {...props} />);
}

describe("SidebarGistList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
    useGistStore.setState({ selectGist, togglePin } as never);
  });
  afterEach(() => cleanup());

  // ── languageColor pure fn ──────────────────────────────────────────────────

  it("languageColor maps known languages and falls back for unknown/null", () => {
    expect(languageColor("TypeScript")).toBe("#3178c6");
    expect(languageColor("Python")).toBe("#3572A5");
    expect(languageColor("Brainfuck")).toBe("#8b949e");
    expect(languageColor(null)).toBe("#8b949e");
  });

  // ── Empty / skeleton states (keyword mode) ─────────────────────────────────

  it("shows the skeleton while syncing with no gists yet", () => {
    renderList({ gists: [], syncStatus: "syncing", filteredGists: [] });
    expect(document.querySelectorAll(".skeleton-item").length).toBeGreaterThan(0);
  });

  it("shows the no-gists message when empty and not syncing", () => {
    renderList({ gists: [], syncStatus: "idle", filteredGists: [] });
    expect(screen.getByText(en.sidebar.noGists)).toBeTruthy();
  });

  it("shows the no-results message when a search yields nothing", () => {
    renderList({ filteredGists: [], syncStatus: "idle", searchQuery: "zzz" });
    expect(screen.getByText(en.sidebar.noResults)).toBeTruthy();
  });

  it("shows the filtered-empty message when locally filtered", () => {
    renderList({ filteredGists: [], syncStatus: "idle", isLocallyFiltered: true });
    expect(screen.getByText(en.sidebar.noGistsFilter)).toBeTruthy();
  });

  // ── Semantic mode (renders GistItem directly, no virtualizer) ───────────────

  it("renders gist items with score bars in semantic mode", () => {
    const g = makeGist({ id: "g1", description: "Vector hit" });
    renderList({
      searchMode: "semantic",
      searchQuery: "find",
      semanticGists: [g],
      semanticScoreMap: new Map([["g1", 0.87]]),
    });
    expect(screen.getByText("main.ts")).toBeTruthy();
    const bar = document.querySelector(".sidebar__score-bar__fill") as HTMLElement;
    expect(bar.style.width).toBe("87%");
  });

  it("shows the no-semantic-matches message when empty", () => {
    renderList({
      searchMode: "semantic",
      searchQuery: "find",
      semanticGists: [],
      semanticBusy: false,
      semanticError: null,
    });
    expect(screen.getByText(en.sidebar.noSemanticMatches)).toBeTruthy();
  });

  it("shows the semantic error when present", () => {
    renderList({
      searchMode: "semantic",
      searchQuery: "find",
      semanticError: "Embedding index not built",
    });
    expect(screen.getByText("Embedding index not built")).toBeTruthy();
  });

  // ── GistItem interactions ───────────────────────────────────────────────────

  it("clicking a gist row selects it (non-select mode)", () => {
    const g = makeGist({ id: "gX" });
    renderList({ searchMode: "semantic", searchQuery: "q", semanticGists: [g] });
    fireEvent.click(screen.getByText("main.ts"));
    expect(selectGist).toHaveBeenCalledWith("gX");
  });

  it("clicking a gist row in select mode toggles its check instead", () => {
    const toggleCheck = vi.fn();
    const g = makeGist({ id: "gC" });
    renderList({
      searchMode: "semantic", searchQuery: "q", semanticGists: [g],
      selectMode: true, toggleCheck,
    });
    fireEvent.click(screen.getByText("main.ts"));
    expect(toggleCheck).toHaveBeenCalledWith("gC");
    expect(selectGist).not.toHaveBeenCalled();
  });

  it("clicking the pin toggles pin without selecting the row", () => {
    const g = makeGist({ id: "gP" });
    renderList({ searchMode: "semantic", searchQuery: "q", semanticGists: [g] });
    fireEvent.click(screen.getByText("♦"));
    expect(togglePin).toHaveBeenCalledWith("gP");
    expect(selectGist).not.toHaveBeenCalled();
  });

  it("renders the pin icon and description for a pinned gist", () => {
    const g = makeGist({ id: "gPin", pinned: true, description: "Pinned one" });
    renderList({ searchMode: "semantic", searchQuery: "q", semanticGists: [g] });
    expect(screen.getByText("Pinned one")).toBeTruthy();
    expect(screen.getByTitle("Pinned")).toBeTruthy();
  });

  it("right-click opens the context menu with coordinates", () => {
    const openCtxMenu = vi.fn();
    const g = makeGist({ id: "gM" });
    renderList({ searchMode: "semantic", searchQuery: "q", semanticGists: [g], openCtxMenu });
    fireEvent.contextMenu(screen.getByText("main.ts"), { clientX: 42, clientY: 99 });
    expect(openCtxMenu).toHaveBeenCalledWith(expect.objectContaining({ id: "gM" }), 42, 99);
  });

  it("shows the draft badge for local-only gists", () => {
    const g = makeGist({ id: "gD", local_only: true });
    renderList({ searchMode: "semantic", searchQuery: "q", semanticGists: [g] });
    expect(screen.getByText(en.common.draft)).toBeTruthy();
  });

  // ── Accessibility ───────────────────────────────────────────────────────────

  it("the gist row is a keyboard-operable role=button", () => {
    const g = makeGist({ id: "gA" });
    const { container } = renderList({ searchMode: "semantic", searchQuery: "q", semanticGists: [g] });
    const row = container.querySelector(".gist-item") as HTMLElement;
    expect(row.getAttribute("role")).toBe("button");
    expect(row.tabIndex).toBe(0);
  });

  it("pressing Enter on the row selects the gist", () => {
    const g = makeGist({ id: "gEnter" });
    const { container } = renderList({ searchMode: "semantic", searchQuery: "q", semanticGists: [g] });
    const row = container.querySelector(".gist-item") as HTMLElement;
    fireEvent.keyDown(row, { key: "Enter" });
    expect(selectGist).toHaveBeenCalledWith("gEnter");
  });

  it("the pin is a real button with an accessible label and pressed state", () => {
    const g = makeGist({ id: "gPinBtn", pinned: true });
    const { container } = renderList({ searchMode: "semantic", searchQuery: "q", semanticGists: [g] });
    const pin = within(container).getByRole("button", { name: en.sidebar.unpin });
    expect(pin.tagName).toBe("BUTTON");
    expect(pin.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the checkbox in select mode", () => {
    const g = makeGist({ id: "gCk" });
    renderList({
      searchMode: "semantic", searchQuery: "q", semanticGists: [g],
      selectMode: true, checkedIds: new Set(["gCk"]),
    });
    expect(document.querySelector(".gist-item__checkbox--checked")).toBeTruthy();
  });
});
