import { create } from "zustand";
import { persist } from "zustand/middleware";

const MAX = 15;

interface RecentState {
  ids: string[];
  push: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const useRecentStore = create<RecentState>()(
  persist(
    (set) => ({
      ids: [],
      push: (id) =>
        set((s) => ({
          ids: [id, ...s.ids.filter((x) => x !== id)].slice(0, MAX),
        })),
      remove: (id) => set((s) => ({ ids: s.ids.filter((x) => x !== id) })),
      clear: () => set({ ids: [] }),
    }),
    { name: "gist-recent" }
  )
);
