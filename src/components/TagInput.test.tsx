import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { TagInput } from "./TagInput";
import { useI18nStore } from "../store/useI18nStore";
import type { Tag } from "../api/tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../api/tauri");

function tag(id: number, name: string, color = "#58a6ff"): Tag {
  return { id, name, color } as Tag;
}

function renderInput(props: Partial<React.ComponentProps<typeof TagInput>> = {}) {
  const onAdd = vi.fn().mockResolvedValue(undefined);
  const onRemove = vi.fn().mockResolvedValue(undefined);
  const onCreateAndAdd = vi.fn().mockResolvedValue(undefined);
  render(
    <TagInput
      tags={props.tags ?? []}
      allTags={props.allTags ?? []}
      onAdd={onAdd}
      onRemove={onRemove}
      onCreateAndAdd={onCreateAndAdd}
      {...props}
    />,
  );
  return { onAdd, onRemove, onCreateAndAdd };
}

describe("TagInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
  });
  afterEach(() => cleanup());

  it("renders existing tag chips", () => {
    renderInput({ tags: [tag(1, "rust"), tag(2, "cli")] });
    expect(screen.getByText("rust")).toBeTruthy();
    expect(screen.getByText("cli")).toBeTruthy();
  });

  it("clicking a chip's × calls onRemove", () => {
    const { onRemove } = renderInput({ tags: [tag(7, "go")] });
    fireEvent.click(screen.getByTitle('Remove tag "go"'));
    expect(onRemove).toHaveBeenCalledWith(7);
  });

  it("the dropdown is closed until the add button is clicked", () => {
    renderInput({ allTags: [tag(1, "rust")] });
    expect(screen.queryByPlaceholderText("Search or create…")).toBeNull();
    fireEvent.click(screen.getByTitle("Add tag"));
    expect(screen.getByPlaceholderText("Search or create…")).toBeTruthy();
  });

  it("lists available (not-yet-applied) tags in the dropdown", () => {
    renderInput({ tags: [tag(1, "rust")], allTags: [tag(1, "rust"), tag(2, "cli")] });
    fireEvent.click(screen.getByTitle("Add tag"));
    // rust is already applied → only cli is available
    expect(screen.getByText("cli")).toBeTruthy();
  });

  it("filters available tags by the typed query", () => {
    renderInput({ allTags: [tag(1, "rust"), tag(2, "python")] });
    fireEvent.click(screen.getByTitle("Add tag"));
    fireEvent.change(screen.getByPlaceholderText("Search or create…"), { target: { value: "py" } });
    expect(screen.getByText("python")).toBeTruthy();
    expect(screen.queryByText("rust")).toBeNull();
  });

  it("clicking an available tag calls onAdd", async () => {
    const { onAdd } = renderInput({ allTags: [tag(5, "docker")] });
    fireEvent.click(screen.getByTitle("Add tag"));
    fireEvent.click(screen.getByText("docker"));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(5));
  });

  it("offers to create a novel tag and calls onCreateAndAdd", async () => {
    const { onCreateAndAdd } = renderInput({ allTags: [tag(1, "rust")] });
    fireEvent.click(screen.getByTitle("Add tag"));
    fireEvent.change(screen.getByPlaceholderText("Search or create…"), { target: { value: "newtag" } });
    fireEvent.click(screen.getByText('+ Create "newtag"'));
    await waitFor(() =>
      expect(onCreateAndAdd).toHaveBeenCalledWith("newtag", expect.any(String)),
    );
  });

  it("Enter adds the first available match", async () => {
    const { onAdd } = renderInput({ allTags: [tag(9, "alpha"), tag(10, "alps")] });
    fireEvent.click(screen.getByTitle("Add tag"));
    const input = screen.getByPlaceholderText("Search or create…");
    fireEvent.change(input, { target: { value: "alp" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(9));
  });

  it("Enter creates a new tag when there is no match", async () => {
    const { onCreateAndAdd } = renderInput({ allTags: [] });
    fireEvent.click(screen.getByTitle("Add tag"));
    const input = screen.getByPlaceholderText("Search or create…");
    fireEvent.change(input, { target: { value: "brand-new" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onCreateAndAdd).toHaveBeenCalledWith("brand-new", expect.any(String)));
  });

  it("Escape closes the dropdown", () => {
    renderInput({ allTags: [tag(1, "rust")] });
    fireEvent.click(screen.getByTitle("Add tag"));
    const input = screen.getByPlaceholderText("Search or create…");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByPlaceholderText("Search or create…")).toBeNull();
  });

  it("shows the no-matching-tags message", () => {
    renderInput({ tags: [tag(1, "rust")], allTags: [tag(1, "rust")] });
    fireEvent.click(screen.getByTitle("Add tag"));
    // query empty + nothing available → "No tags yet"
    expect(screen.getByText("No tags yet — type to create one")).toBeTruthy();
  });

  it("closes the dropdown on an outside click", () => {
    renderInput({ allTags: [tag(1, "rust")] });
    fireEvent.click(screen.getByTitle("Add tag"));
    expect(screen.getByPlaceholderText("Search or create…")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByPlaceholderText("Search or create…")).toBeNull();
  });
});
