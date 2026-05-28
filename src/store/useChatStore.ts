import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  actionLabel?: string;
}

const MAX_GISTS = 20;
const MAX_MSGS = 60;

interface ChatState {
  history: Record<string, ChatMsg[]>;
  setHistory: (gistId: string, msgs: ChatMsg[]) => void;
  clearHistory: (gistId: string) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      history: {},
      setHistory: (gistId, msgs) =>
        set((state) => {
          const trimmed = msgs.slice(-MAX_MSGS);
          const next = { ...state.history, [gistId]: trimmed };
          const keys = Object.keys(next);
          if (keys.length > MAX_GISTS) {
            for (const k of keys.slice(0, keys.length - MAX_GISTS)) {
              delete next[k];
            }
          }
          return { history: next };
        }),
      clearHistory: (gistId) =>
        set((state) => {
          const next = { ...state.history };
          delete next[gistId];
          return { history: next };
        }),
    }),
    { name: "gists-client-chat" }
  )
);
