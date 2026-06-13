import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { CollectionPicker } from "./CollectionPicker";
import { useGistStore } from "../store/useGistStore";
import { useI18nStore } from "../store/useI18nStore";
import type { Collection, CollectionCount } from "../api/tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../api/tauri");

function makeCount(overrides: Partial<CollectionCount> = {}): CollectionCount {
  return { id: "c1", name: "Work", color: "#6366f1", icon: "folder", count: 0, ...overrides };
}

function makeMembership(overrides: Partial<Collection> = {}): Collection {
  return {
    id: "c1",
    name: "Work",
    description: "",
    color: "#6366f1",
    icon: "folder",
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

const GIST_ID = "g1";

describe("CollectionPicker", () => {
  let loadGistCollections: ReturnType<typeof vi.fn>;
  let addGistToCollection: ReturnType<typeof vi.fn>;
  let removeGistFromCollection: ReturnType<typeof vi.fn>;
  let createCollection: ReturnType<typeof vi.fn>;

  function seed(opts: {
    allCollections?: CollectionCount[];
    membership?: Collection[];
  } = {}) {
    useGistStore.setState({
      allCollections: opts.allCollections ?? [],
      gistCollections: { [GIST_ID]: opts.membership ?? [] },
      loadGistCollections,
      addGistToCollection,
      removeGistFromCollection,
      createCollection,
    } as never);
  }

  beforeEach(() => {
    useI18nStore.setState({ lang: "en" });
    loadGistCollections = vi.fn().mockResolvedValue(undefined);
    addGistToCollection = vi.fn().mockResolvedValue(undefined);
    removeGistFromCollection = vi.fn().mockResolvedValue(undefined);
    createCollection = vi.fn().mockResolvedValue(makeMembership({ id: "new1", name: "New" }));
  });

  afterEach(() => cleanup());

  it("loads the gist's collections on mount", () => {
    seed();
    render(<CollectionPicker gistId={GIST_ID} />);
    expect(loadGistCollections).toHaveBeenCalledWith(GIST_ID);
  });

  it("renders current membership chips", () => {
    seed({ membership: [makeMembership({ id: "c1", name: "Work" })] });
    render(<CollectionPicker gistId={GIST_ID} />);
    expect(screen.getByText("Work")).toBeTruthy();
  });

  it("shows the 'Add to collection' label when there is no membership", () => {
    seed({ membership: [] });
    render(<CollectionPicker gistId={GIST_ID} />);
    expect(screen.getByText("Add to collection")).toBeTruthy();
  });

  it("opens a dropdown listing all collections", () => {
    seed({
      membership: [],
      allCollections: [makeCount({ id: "c1", name: "Work" }), makeCount({ id: "c2", name: "Personal" })],
    });
    render(<CollectionPicker gistId={GIST_ID} />);
    fireEvent.click(screen.getByText("Add to collection"));
    expect(screen.getByText("Personal")).toBeTruthy();
  });

  it("shows the empty message when there are no collections", () => {
    seed({ membership: [], allCollections: [] });
    render(<CollectionPicker gistId={GIST_ID} />);
    fireEvent.click(screen.getByText("Add to collection"));
    expect(screen.getByText("No collections yet.")).toBeTruthy();
  });

  it("toggling a non-member collection calls addGistToCollection", () => {
    seed({ membership: [], allCollections: [makeCount({ id: "c1", name: "Work" })] });
    render(<CollectionPicker gistId={GIST_ID} />);
    fireEvent.click(screen.getByText("Add to collection"));
    fireEvent.click(screen.getByText("Work"));
    expect(addGistToCollection).toHaveBeenCalledWith("c1", GIST_ID);
  });

  it("toggling a member collection calls removeGistFromCollection", () => {
    seed({
      membership: [makeMembership({ id: "c1", name: "Work" })],
      allCollections: [makeCount({ id: "c1", name: "Work" })],
    });
    render(<CollectionPicker gistId={GIST_ID} />);
    // With a membership the add button collapses to "+"
    fireEvent.click(screen.getByText("+"));
    // The collection appears both as a chip and in the dropdown list; click
    // the dropdown list item (button inside the list).
    const listItem = screen
      .getAllByText("Work")
      .map((el) => el.closest("button"))
      .find((btn) => btn?.className.includes("col-picker__list-item"));
    fireEvent.click(listItem!);
    expect(removeGistFromCollection).toHaveBeenCalledWith("c1", GIST_ID);
  });

  it("removing a chip calls removeGistFromCollection", () => {
    seed({ membership: [makeMembership({ id: "c1", name: "Work" })] });
    render(<CollectionPicker gistId={GIST_ID} />);
    fireEvent.click(screen.getByTitle("Remove from Work"));
    expect(removeGistFromCollection).toHaveBeenCalledWith("c1", GIST_ID);
  });

  it("the New collection link reveals the create form", () => {
    seed({ membership: [], allCollections: [] });
    render(<CollectionPicker gistId={GIST_ID} />);
    fireEvent.click(screen.getByText("Add to collection"));
    fireEvent.click(screen.getByText("+ New collection"));
    expect(screen.getByPlaceholderText("Collection name…")).toBeTruthy();
  });

  it("creating a collection calls createCollection then adds the gist to it", async () => {
    seed({ membership: [], allCollections: [] });
    render(<CollectionPicker gistId={GIST_ID} />);
    fireEvent.click(screen.getByText("Add to collection"));
    fireEvent.click(screen.getByText("+ New collection"));
    fireEvent.change(screen.getByPlaceholderText("Collection name…"), {
      target: { value: "Docs" },
    });
    fireEvent.click(screen.getByText("Create"));
    await waitFor(() =>
      expect(createCollection).toHaveBeenCalledWith("Docs", "", "#6366f1", "folder")
    );
    await waitFor(() => expect(addGistToCollection).toHaveBeenCalledWith("new1", GIST_ID));
  });
});
