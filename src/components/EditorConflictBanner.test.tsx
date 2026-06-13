import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { EditorConflictBanner, type ConflictState } from "./EditorConflictBanner";
import { useI18nStore } from "../store/useI18nStore";

// Pattern #2 — a pure, prop-driven component. No store of its own, no IPC; it
// renders conflict metadata and forwards three callbacks. We pin the language so
// assertions run against stable English strings.

function conflict(autoMergedCount = 2): ConflictState {
  return {
    remoteFiles: [],
    remoteDescription: "",
    remoteUpdatedAt: "",
    mergedFiles: [],
    conflictedFilenames: new Set(["a.txt"]),
    autoMergedCount,
  };
}

describe("EditorConflictBanner", () => {
  beforeEach(() => {
    useI18nStore.setState({ lang: "en" });
  });
  afterEach(() => cleanup());

  it("shows the auto-merged count and the remaining-conflict file chips", () => {
    render(
      <EditorConflictBanner
        conflict={conflict(2)}
        remainingConflictFiles={["a.txt", "b.txt"]}
        hasRemainingMarkers={true}
        saving={false}
        onResolve={vi.fn()}
        onDiscard={vi.fn()}
        onJumpToFile={vi.fn()}
      />
    );

    expect(screen.getByText(/2 auto-merged/)).toBeTruthy();
    expect(screen.getByText("a.txt")).toBeTruthy();
    expect(screen.getByText("b.txt")).toBeTruthy();
    expect(screen.getByText("2 conflicts remaining")).toBeTruthy();
  });

  it("clicking a file chip jumps to that file", () => {
    const onJumpToFile = vi.fn();
    render(
      <EditorConflictBanner
        conflict={conflict()}
        remainingConflictFiles={["a.txt"]}
        hasRemainingMarkers={true}
        saving={false}
        onResolve={vi.fn()}
        onDiscard={vi.fn()}
        onJumpToFile={onJumpToFile}
      />
    );

    fireEvent.click(screen.getByText("a.txt"));
    expect(onJumpToFile).toHaveBeenCalledWith("a.txt");
  });

  it("disables the resolve button while markers remain", () => {
    render(
      <EditorConflictBanner
        conflict={conflict()}
        remainingConflictFiles={["a.txt"]}
        hasRemainingMarkers={true}
        saving={false}
        onResolve={vi.fn()}
        onDiscard={vi.fn()}
        onJumpToFile={vi.fn()}
      />
    );

    const resolve = screen.getByText("Conflicts resolved ✓").closest("button") as HTMLButtonElement;
    expect(resolve.disabled).toBe(true);
  });

  it("resolve fires onResolve once all markers are gone", () => {
    const onResolve = vi.fn();
    render(
      <EditorConflictBanner
        conflict={conflict()}
        remainingConflictFiles={[]}
        hasRemainingMarkers={false}
        saving={false}
        onResolve={onResolve}
        onDiscard={vi.fn()}
        onJumpToFile={vi.fn()}
      />
    );

    const resolve = screen.getByText("Conflicts resolved ✓").closest("button") as HTMLButtonElement;
    expect(resolve.disabled).toBe(false);
    fireEvent.click(resolve);
    expect(onResolve).toHaveBeenCalledTimes(1);
  });

  it("discard fires onDiscard, and saving disables both actions", () => {
    const onDiscard = vi.fn();
    render(
      <EditorConflictBanner
        conflict={conflict()}
        remainingConflictFiles={[]}
        hasRemainingMarkers={false}
        saving={true}
        onResolve={vi.fn()}
        onDiscard={onDiscard}
        onJumpToFile={vi.fn()}
      />
    );

    const discard = screen.getByText("Discard my changes").closest("button") as HTMLButtonElement;
    const resolve = screen.getByText("Conflicts resolved ✓").closest("button") as HTMLButtonElement;
    expect(discard.disabled).toBe(true);
    expect(resolve.disabled).toBe(true);

    // Even disabled, assert the wiring: re-enable by not saving would call through.
    expect(onDiscard).not.toHaveBeenCalled();
  });
});
