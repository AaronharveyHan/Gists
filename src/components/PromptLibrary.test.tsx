import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { PromptLibrary } from "./PromptLibrary";
import { useGistStore } from "../store/useGistStore";
import { useI18nStore } from "../store/useI18nStore";
import * as api from "../api/tauri";
import type { Gist, GistFile } from "../api/tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../api/tauri");
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn().mockResolvedValue(undefined) }));

function makeFile(overrides: Partial<GistFile> = {}): GistFile {
  return { filename: "prompt.md", language: null, content: "Hello world", size: 11, raw_url: null, ...overrides };
}

function makeGist(overrides: Partial<Gist> = {}): Gist {
  return {
    id: "g1",
    description: "My Prompt",
    public: false,
    html_url: "",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    files: [makeFile()],
    pending_push: false,
    local_only: true,
    category: "prompt",
    pinned: false,
    ...overrides,
  };
}

function seedGists(gists: Gist[]) {
  useGistStore.setState({ gists } as never);
}

function renderLib(
  props: Partial<React.ComponentProps<typeof PromptLibrary>> = {},
) {
  const onClose = vi.fn();
  render(
    <PromptLibrary onClose={onClose} {...props} />,
  );
  return { onClose };
}

describe("PromptLibrary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
    seedGists([]);
  });
  afterEach(() => cleanup());

  it("renders the panel title", () => {
    renderLib();
    expect(screen.getByText("Prompt Library")).toBeTruthy();
  });

  it("shows the empty message when no prompts exist", () => {
    renderLib();
    expect(screen.getByText("No prompts yet. Create one or mark a gist as a prompt.")).toBeTruthy();
  });

  it("lists prompt gists by description", () => {
    seedGists([makeGist({ id: "a", description: "Alpha Prompt" }), makeGist({ id: "b", description: "Beta Prompt" })]);
    renderLib();
    // description appears in list item + detail pane
    expect(screen.getAllByText("Alpha Prompt").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Beta Prompt").length).toBeGreaterThanOrEqual(1);
  });

  it("auto-selects the first prompt and shows its detail", () => {
    seedGists([makeGist({ description: "First Prompt", files: [makeFile({ content: "Hello world" })] })]);
    renderLib();
    // appears in list item and detail pane header
    expect(screen.getAllByText("First Prompt").length).toBeGreaterThanOrEqual(2);
  });

  it("filters the list by description query", () => {
    seedGists([
      makeGist({ id: "a", description: "Alpha Prompt" }),
      makeGist({ id: "b", description: "Beta Prompt" }),
    ]);
    renderLib();
    const search = screen.getByPlaceholderText("Search prompts…");
    fireEvent.change(search, { target: { value: "alpha" } });
    // Alpha shows in list + detail pane; Beta must not appear
    expect(screen.getAllByText("Alpha Prompt").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Beta Prompt")).toBeNull();
  });

  it("shows 'No matching prompts' when filter has no results", () => {
    seedGists([makeGist({ description: "Alpha Prompt" })]);
    renderLib();
    const search = screen.getByPlaceholderText("Search prompts…");
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("No matching prompts.")).toBeTruthy();
  });

  it("shows var pill when template contains {{variable}}", () => {
    seedGists([makeGist({ files: [makeFile({ content: "Hello {{name}}!" })] })]);
    renderLib();
    expect(screen.getByText("{{name}}")).toBeTruthy();
  });

  it("shows variable fill inputs when a prompt has vars", () => {
    seedGists([makeGist({ files: [makeFile({ content: "Dear {{name}}, regards {{sender}}" })] })]);
    renderLib();
    expect(screen.getByPlaceholderText("name")).toBeTruthy();
    expect(screen.getByPlaceholderText("sender")).toBeTruthy();
  });

  it("calls onInsert with rendered text and closes", () => {
    seedGists([makeGist({ files: [makeFile({ content: "Hello world" })] })]);
    const onInsert = vi.fn();
    const { onClose } = renderLib({ onInsert });
    fireEvent.click(screen.getByText("Insert into Chat"));
    expect(onInsert).toHaveBeenCalledWith("Hello world");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders Edit button when onNavigate is provided and calls it", () => {
    seedGists([makeGist({ id: "g42" })]);
    const onNavigate = vi.fn();
    const { onClose } = renderLib({ onNavigate });
    fireEvent.click(screen.getByText("Edit ↗"));
    expect(onNavigate).toHaveBeenCalledWith("g42");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Copy button calls writeText", async () => {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    seedGists([makeGist({ files: [makeFile({ content: "Hello world" })] })]);
    renderLib();
    fireEvent.click(screen.getByText("Copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Hello world"));
  });

  it("shows the new-prompt form when + is clicked", () => {
    renderLib();
    fireEvent.click(screen.getByTitle("New prompt"));
    expect(screen.getByPlaceholderText("Prompt name…")).toBeTruthy();
    expect(screen.getByPlaceholderText(/Write your prompt here/)).toBeTruthy();
  });

  it("Create Prompt button is disabled when name or body is empty", () => {
    renderLib();
    fireEvent.click(screen.getByTitle("New prompt"));
    const btn = screen.getByText("Create Prompt");
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("creates a prompt via API and refreshes gist list", async () => {
    const newGist = makeGist({ id: "new1", description: "New Prompt" });
    vi.mocked(api.createLocalGist).mockResolvedValue(newGist);
    vi.mocked(api.setGistCategory).mockResolvedValue(undefined);

    const loadGistsSpy = vi.fn().mockResolvedValue(undefined);
    useGistStore.setState({ loadGists: loadGistsSpy } as never);

    renderLib();
    fireEvent.click(screen.getByTitle("New prompt"));

    fireEvent.change(screen.getByPlaceholderText("Prompt name…"), { target: { value: "New Prompt" } });
    fireEvent.change(screen.getByPlaceholderText(/Write your prompt here/), { target: { value: "My prompt body" } });

    await act(async () => {
      fireEvent.click(screen.getByText("Create Prompt"));
    });

    expect(api.createLocalGist).toHaveBeenCalledWith("New Prompt", false, [["prompt.md", "My prompt body"]]);
    expect(api.setGistCategory).toHaveBeenCalledWith("new1", "prompt");
    expect(loadGistsSpy).toHaveBeenCalled();
  });

  it("Escape calls onClose", () => {
    const { onClose } = renderLib();
    fireEvent.keyDown(screen.getByText("Prompt Library").closest(".prompt-lib") as HTMLElement, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clicking the overlay calls onClose", () => {
    const { onClose } = renderLib();
    const overlay = document.querySelector(".prompt-lib__overlay") as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ArrowDown navigates to the next prompt", () => {
    seedGists([
      makeGist({ id: "a", description: "Alpha Prompt" }),
      makeGist({ id: "b", description: "Beta Prompt" }),
    ]);
    renderLib();
    const lib = document.querySelector(".prompt-lib") as HTMLElement;
    fireEvent.keyDown(lib, { key: "ArrowDown" });
    const items = document.querySelectorAll(".prompt-lib__item--active");
    expect(items.length).toBe(1);
    expect(items[0].textContent).toContain("Beta Prompt");
  });
});
