import { create } from "zustand";

export type View =
  | { name: "decks" }
  | { name: "import" }
  | { name: "review"; deckId: number }
  | { name: "viewer"; deckId: number }
  | { name: "settings"; deckId: number };

interface AppState {
  view: View;
  setView: (v: View) => void;
}

export const useApp = create<AppState>((set) => ({
  view: { name: "decks" },
  setView: (view) => set({ view }),
}));
