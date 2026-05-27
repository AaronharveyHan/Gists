import { create } from "zustand";

export interface Notification {
  id: number;
  message: string;
  type: "error" | "success" | "info";
}

let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

interface NotificationState {
  items: Notification[];
  add: (message: string, type?: Notification["type"]) => void;
  dismiss: (id: number) => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  items: [],

  add: (message, type = "error") => {
    const id = nextId++;
    const timer = setTimeout(() => {
      timers.delete(id);
      set((s) => ({ items: s.items.filter((n) => n.id !== id) }));
    }, 4000);
    timers.set(id, timer);
    set((s) => ({ items: [...s.items, { id, message, type }] }));
  },

  dismiss: (id) => {
    const timer = timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(id);
    }
    set((s) => ({ items: s.items.filter((n) => n.id !== id) }));
  },
}));

export const notify = useNotificationStore.getState().add;
