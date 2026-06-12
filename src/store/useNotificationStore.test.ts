import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useNotificationStore } from "./useNotificationStore";

describe("useNotificationStore", () => {
  beforeEach(() => {
    useNotificationStore.setState({ items: [] });
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('add() appends a notification with default type "error"', () => {
    useNotificationStore.getState().add("something broke");
    const { items } = useNotificationStore.getState();
    expect(items).toHaveLength(1);
    expect(items[0].message).toBe("something broke");
    expect(items[0].type).toBe("error");
  });

  it("add() accepts a custom type", () => {
    useNotificationStore.getState().add("saved", "success");
    expect(useNotificationStore.getState().items[0].type).toBe("success");
  });

  it("add() accumulates multiple notifications", () => {
    useNotificationStore.getState().add("one");
    useNotificationStore.getState().add("two");
    expect(useNotificationStore.getState().items).toHaveLength(2);
  });

  it("dismiss() removes the notification immediately", () => {
    useNotificationStore.getState().add("hello");
    const { id } = useNotificationStore.getState().items[0];
    useNotificationStore.getState().dismiss(id);
    expect(useNotificationStore.getState().items).toHaveLength(0);
  });

  it("notifications auto-dismiss after 4 seconds", () => {
    useNotificationStore.getState().add("auto");
    expect(useNotificationStore.getState().items).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(useNotificationStore.getState().items).toHaveLength(0);
  });

  it("dismiss() before 4 s clears the pending auto-dismiss timer", () => {
    useNotificationStore.getState().add("early");
    const { id } = useNotificationStore.getState().items[0];
    useNotificationStore.getState().dismiss(id);
    vi.advanceTimersByTime(4000); // timer was cancelled — should be a no-op
    expect(useNotificationStore.getState().items).toHaveLength(0);
  });

  it("dismiss() is a no-op for an unknown id", () => {
    useNotificationStore.getState().add("real");
    useNotificationStore.getState().dismiss(-999);
    expect(useNotificationStore.getState().items).toHaveLength(1);
  });
});
