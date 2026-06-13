import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";

// Baseline pattern #2 — a pure interactive component (no store, no IPC).
// Exercises portal rendering, callback props, keyboard navigation, and the
// outside-click / Escape close behaviour. The component attaches its
// outside-click listeners inside a setTimeout(0), so those tests use fake
// timers and flush the 0ms tick before dispatching the event.

function entries(onA = vi.fn(), onB = vi.fn()): { items: ContextMenuEntry[]; onA: typeof onA; onB: typeof onB } {
  return {
    items: [
      { label: "Open", icon: "📂", shortcut: "⌘O", onClick: onA },
      { separator: true },
      { label: "Delete", danger: true, onClick: onB },
    ],
    onA,
    onB,
  };
}

describe("ContextMenu", () => {
  afterEach(() => cleanup());

  it("renders actions as menuitems and separators as separators", () => {
    const { items } = entries();
    render(<ContextMenu x={10} y={10} items={items} onClose={vi.fn()} />);

    const menuitems = screen.getAllByRole("menuitem");
    expect(menuitems.map((b) => b.textContent)).toEqual(["📂Open⌘O", "Delete"]);
    expect(screen.getAllByRole("separator")).toHaveLength(1);
  });

  it("becomes visible and is positioned at the requested coordinates", () => {
    const { items } = entries();
    render(<ContextMenu x={42} y={84} items={items} onClose={vi.fn()} />);
    const menu = screen.getByRole("menu") as HTMLElement;
    // jsdom's getBoundingClientRect is all-zero, so no viewport flip happens.
    expect(menu.style.left).toBe("42px");
    expect(menu.style.top).toBe("84px");
    expect(menu.style.visibility).toBe("visible");
  });

  it("clicking an action fires its onClick and then closes", () => {
    const onClose = vi.fn();
    const { items, onA } = entries();
    render(<ContextMenu x={0} y={0} items={items} onClose={onClose} />);

    fireEvent.click(screen.getByText("Open"));
    expect(onA).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("marks danger actions with a modifier class", () => {
    const { items } = entries();
    render(<ContextMenu x={0} y={0} items={items} onClose={vi.fn()} />);
    expect(screen.getByText("Delete").closest("button")?.className).toContain("ctx-menu__item--danger");
  });

  it("a disabled action renders disabled and does not fire on click", () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    const items: ContextMenuEntry[] = [{ label: "Nope", disabled: true, onClick }];
    render(<ContextMenu x={0} y={0} items={items} onClose={onClose} />);

    const btn = screen.getByText("Nope").closest("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("Escape closes the menu", () => {
    const onClose = vi.fn();
    const { items } = entries();
    render(<ContextMenu x={0} y={0} items={items} onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ArrowDown highlights an item and Enter activates it", () => {
    const onClose = vi.fn();
    const { items, onA } = entries();
    render(<ContextMenu x={0} y={0} items={items} onClose={onClose} />);

    act(() => {
      fireEvent.keyDown(window, { key: "ArrowDown" }); // highlight first action ("Open")
    });
    expect(screen.getByText("Open").closest("button")?.className).toContain("ctx-menu__item--active");

    act(() => {
      fireEvent.keyDown(window, { key: "Enter" });
    });
    expect(onA).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe("outside-click close (listeners attach after a 0ms tick)", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
      vi.clearAllTimers();
      vi.useRealTimers();
    });

    it("mousedown outside the menu closes it", () => {
      const onClose = vi.fn();
      const { items } = entries();
      render(<ContextMenu x={0} y={0} items={items} onClose={onClose} />);

      act(() => vi.advanceTimersByTime(0)); // let the outside-click listener attach
      fireEvent.mouseDown(document.body);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("mousedown inside the menu does not close it", () => {
      const onClose = vi.fn();
      const { items } = entries();
      render(<ContextMenu x={0} y={0} items={items} onClose={onClose} />);

      act(() => vi.advanceTimersByTime(0));
      fireEvent.mouseDown(screen.getByRole("menu"));
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
