import { create } from "zustand";

interface EditorUIState {
  cursorLine: number;
  cursorColumn: number;
  selectedChars: number;
  selectedLines: number;
  activeFilename: string | null;
  setCursor: (line: number, col: number) => void;
  setSelection: (chars: number, lines: number) => void;
  setActiveFilename: (name: string | null) => void;
}

export const useEditorUIStore = create<EditorUIState>((set) => ({
  cursorLine: 1,
  cursorColumn: 1,
  selectedChars: 0,
  selectedLines: 0,
  activeFilename: null,
  setCursor: (line, col) => set({ cursorLine: line, cursorColumn: col }),
  setSelection: (chars, lines) =>
    set({ selectedChars: chars, selectedLines: lines }),
  setActiveFilename: (name) => set({ activeFilename: name }),
}));
