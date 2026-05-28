import { useEffect } from "react";

type Handler = (e: KeyboardEvent) => void;

/**
 * Register a global keyboard shortcut.
 * key: e.g. "k", modifier: "meta" | "ctrl" | "shift" | "meta+shift" | "alt" | null
 */
export function useKeyboard(
  key: string,
  modifier: "meta" | "ctrl" | "shift" | "meta+shift" | "alt" | null,
  handler: Handler
): void {
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      let modMatch: boolean;
      switch (modifier) {
        case "meta":
          modMatch = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey;
          break;
        case "ctrl":
          modMatch = e.ctrlKey && !e.shiftKey && !e.altKey;
          break;
        case "shift":
          modMatch = e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
          break;
        case "meta+shift":
          modMatch = (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey;
          break;
        case "alt":
          modMatch = e.altKey && !e.metaKey && !e.ctrlKey;
          break;
        default:
          modMatch = true;
      }

      if (modMatch && e.key.toLowerCase() === key.toLowerCase()) {
        e.preventDefault();
        handler(e);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [key, modifier, handler]);
}
