import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthState {
  localMode: boolean;
  setLocalMode: (v: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      localMode: false,
      setLocalMode: (v) => set({ localMode: v }),
    }),
    { name: "gists-client-auth" }
  )
);
