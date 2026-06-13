import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ShortcutsModal } from "./ShortcutsModal";
import { useI18nStore } from "../store/useI18nStore";

// Baseline pattern #3 — a modal that reads i18n state, closes on Escape, the ✕
// button, and overlay clicks (but not clicks on the modal body). We pin the
// language so assertions run against stable strings.

describe("ShortcutsModal", () => {
  beforeEach(() => {
    localStorage.clear();
    useI18nStore.setState({ lang: "en" });
  });
  afterEach(() => cleanup());

  it("renders the title and every shortcut group", () => {
    render(<ShortcutsModal onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Keyboard Shortcuts" })).toBeTruthy();
    for (const title of ["Navigation", "Editor", "View", "Sidebar", "Markdown"]) {
      expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    }
  });

  it("clicking the ✕ button closes", () => {
    const onClose = vi.fn();
    render(<ShortcutsModal onClose={onClose} />);
    fireEvent.click(screen.getByTitle("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape closes", () => {
    const onClose = vi.fn();
    render(<ShortcutsModal onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("mousedown on the overlay closes, but mousedown on the modal body does not", () => {
    const onClose = vi.fn();
    const { container } = render(<ShortcutsModal onClose={onClose} />);

    const overlay = container.querySelector(".modal-overlay") as HTMLElement;
    const modal = container.querySelector(".shortcuts-modal") as HTMLElement;

    fireEvent.mouseDown(modal); // inside → stays open
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(overlay); // backdrop → closes
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("follows the active language", () => {
    useI18nStore.setState({ lang: "zh" });
    render(<ShortcutsModal onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "键盘快捷键" })).toBeTruthy();
  });
});
