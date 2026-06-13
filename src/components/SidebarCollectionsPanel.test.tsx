import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SidebarCollectionsPanel } from "./SidebarCollectionsPanel";
import { useI18nStore } from "../store/useI18nStore";
import type { CollectionCount } from "../api/tauri";

// No Tauri IPC — SidebarCollectionsPanel is pure React with useT() only.

const noop = async () => {};

function col(id: string, name: string, color = "#6366f1", count = 0): CollectionCount {
  return { id, name, color, count };
}

describe("SidebarCollectionsPanel", () => {
  beforeEach(() => {
    useI18nStore.setState({ lang: "en" });
  });

  it("renders the Collections heading", () => {
    render(
      <SidebarCollectionsPanel
        collections={[]}
        activeCollectionId={null}
        onSelect={vi.fn()}
        onCreate={noop}
        onDelete={noop}
        onRename={noop}
      />
    );
    expect(screen.getByText("Collections")).toBeTruthy();
  });

  it("always shows 'All gists' button", () => {
    render(
      <SidebarCollectionsPanel
        collections={[]}
        activeCollectionId={null}
        onSelect={vi.fn()}
        onCreate={noop}
        onDelete={noop}
        onRename={noop}
      />
    );
    expect(screen.getByText("All gists")).toBeTruthy();
  });

  it("renders collection names", () => {
    render(
      <SidebarCollectionsPanel
        collections={[col("1", "Work"), col("2", "Personal")]}
        activeCollectionId={null}
        onSelect={vi.fn()}
        onCreate={noop}
        onDelete={noop}
        onRename={noop}
      />
    );
    expect(screen.getByText("Work")).toBeTruthy();
    expect(screen.getByText("Personal")).toBeTruthy();
  });

  it("clicking a collection calls onSelect with its id", () => {
    const onSelect = vi.fn();
    render(
      <SidebarCollectionsPanel
        collections={[col("c1", "Demos")]}
        activeCollectionId={null}
        onSelect={onSelect}
        onCreate={noop}
        onDelete={noop}
        onRename={noop}
      />
    );
    fireEvent.click(screen.getByText("Demos"));
    expect(onSelect).toHaveBeenCalledWith("c1");
  });

  it("clicking the active collection deselects (calls onSelect with null)", () => {
    const onSelect = vi.fn();
    render(
      <SidebarCollectionsPanel
        collections={[col("c1", "Demos")]}
        activeCollectionId="c1"
        onSelect={onSelect}
        onCreate={noop}
        onDelete={noop}
        onRename={noop}
      />
    );
    fireEvent.click(screen.getByText("Demos"));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("＋ button toggles the create form", () => {
    render(
      <SidebarCollectionsPanel
        collections={[]}
        activeCollectionId={null}
        onSelect={vi.fn()}
        onCreate={noop}
        onDelete={noop}
        onRename={noop}
      />
    );
    expect(screen.queryByPlaceholderText("Collection name…")).toBeNull();
    fireEvent.click(screen.getByTitle("New collection"));
    expect(screen.getByPlaceholderText("Collection name…")).toBeTruthy();
  });
});
