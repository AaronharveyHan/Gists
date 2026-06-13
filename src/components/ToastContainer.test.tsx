import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { ToastContainer } from "./ToastContainer";
import { useNotificationStore } from "../store/useNotificationStore";

// Baseline pattern #1 — a component whose entire render is driven by a Zustand
// store, and whose only interaction dispatches a store action. We drive it by
// setting store state directly (deterministic, no 4s auto-dismiss timer).

describe("ToastContainer", () => {
  beforeEach(() => {
    useNotificationStore.setState({ items: [] });
  });
  afterEach(() => cleanup());

  it("renders nothing when there are no notifications", () => {
    const { container } = render(<ToastContainer />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one toast per notification, tagged with its type", () => {
    useNotificationStore.setState({
      items: [
        { id: 1, message: "Saved", type: "success" },
        { id: 2, message: "Boom", type: "error" },
        { id: 3, message: "Heads up", type: "info" },
      ],
    });
    render(<ToastContainer />);

    expect(screen.getByText("Saved").closest(".toast")?.className).toContain("toast--success");
    expect(screen.getByText("Boom").closest(".toast")?.className).toContain("toast--error");
    expect(screen.getByText("Heads up").closest(".toast")?.className).toContain("toast--info");
  });

  it("clicking a toast's close button dismisses only that toast", () => {
    useNotificationStore.setState({
      items: [
        { id: 1, message: "First", type: "info" },
        { id: 2, message: "Second", type: "info" },
      ],
    });
    render(<ToastContainer />);

    const firstClose = screen.getByText("First").closest(".toast")!.querySelector(".toast__close")!;
    fireEvent.click(firstClose);

    expect(screen.queryByText("First")).toBeNull();
    expect(screen.getByText("Second")).toBeTruthy();
    expect(useNotificationStore.getState().items.map((n) => n.id)).toEqual([2]);
  });

  it("reflects store updates after the initial render", () => {
    render(<ToastContainer />);
    expect(screen.queryByText("Later")).toBeNull();

    // Store updates land outside React's event loop; wrap so the re-render flushes.
    act(() => {
      useNotificationStore.setState({ items: [{ id: 9, message: "Later", type: "success" }] });
    });
    expect(screen.getByText("Later")).toBeTruthy();
  });
});
