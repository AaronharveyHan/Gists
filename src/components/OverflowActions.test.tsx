import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { OverflowActions } from "./OverflowActions";
import type { OverflowItem } from "./OverflowActions";
import { useI18nStore } from "../store/useI18nStore";

// jsdom lacks ResizeObserver
class ResizeObserverStub {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

function item(over: Partial<OverflowItem> = {}): OverflowItem {
  return {
    key: "k",
    priority: 2,
    node: <button>Node</button>,
    menuLabel: "Menu Item",
    ...over,
  };
}

function renderActions(items: OverflowItem[]) {
  return render(<OverflowActions items={items} />);
}

/** The visible toolbar (excludes the hidden measurement shadow row). */
function toolbar() {
  return within(document.querySelector(".overflow-actions") as HTMLElement);
}

describe("OverflowActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
  });
  afterEach(() => cleanup());

  it("renders the item nodes in the visible toolbar", () => {
    renderActions([item({ key: "a", node: <button>Action A</button>, menuLabel: "A" })]);
    expect(toolbar().getByText("Action A")).toBeTruthy();
  });

  it("does not render hidden items", () => {
    renderActions([
      item({ key: "a", node: <button>Visible</button>, menuLabel: "A" }),
      item({ key: "b", node: <button>Hidden</button>, menuLabel: "B", hidden: true }),
    ]);
    expect(toolbar().getByText("Visible")).toBeTruthy();
    expect(toolbar().queryByText("Hidden")).toBeNull();
  });

  it("places alwaysOverflow items in the ⋯ menu", () => {
    renderActions([
      item({ key: "a", node: <button>Toolbar</button>, menuLabel: "A" }),
      item({ key: "b", node: <span />, menuLabel: "Always Menu", alwaysOverflow: true, priority: 1 }),
    ]);
    // ⋯ button present because there is an overflow item
    const more = screen.getByTitle("More actions");
    fireEvent.click(more);
    expect(screen.getByRole("menuitem", { name: "Always Menu" })).toBeTruthy();
  });

  it("clicking a menu item fires its menuOnClick and closes the menu", () => {
    const menuOnClick = vi.fn();
    renderActions([
      item({ key: "a", node: <button>T</button>, menuLabel: "A" }),
      item({ key: "b", node: <span />, menuLabel: "Do Thing", alwaysOverflow: true, menuOnClick }),
    ]);
    fireEvent.click(screen.getByTitle("More actions"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Do Thing" }));
    expect(menuOnClick).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Escape closes the open menu", () => {
    renderActions([
      item({ key: "a", node: <button>T</button>, menuLabel: "A" }),
      item({ key: "b", node: <span />, menuLabel: "Item", alwaysOverflow: true }),
    ]);
    fireEvent.click(screen.getByTitle("More actions"));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("clicking outside closes the open menu", () => {
    renderActions([
      item({ key: "a", node: <button>T</button>, menuLabel: "A" }),
      item({ key: "b", node: <span />, menuLabel: "Item", alwaysOverflow: true }),
    ]);
    fireEvent.click(screen.getByTitle("More actions"));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows no ⋯ button when nothing overflows", () => {
    renderActions([item({ key: "a", node: <button>Only</button>, menuLabel: "A" })]);
    expect(screen.queryByTitle("More actions")).toBeNull();
  });

  it("renders a disabled menu item as disabled", () => {
    renderActions([
      item({ key: "a", node: <button>T</button>, menuLabel: "A" }),
      item({ key: "b", node: <span />, menuLabel: "Disabled Item", alwaysOverflow: true, menuDisabled: true }),
    ]);
    fireEvent.click(screen.getByTitle("More actions"));
    expect((screen.getByRole("menuitem", { name: "Disabled Item" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
