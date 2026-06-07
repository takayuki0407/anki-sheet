import { create } from "zustand";

export type View =
  | { name: "home" }
  | { name: "decks" }
  | { name: "import" }
  | { name: "viewer"; deckId: number }
  | { name: "settings"; deckId: number }
  | { name: "info" }
  | { name: "login" };

interface AppState {
  view: View;
  setView: (v: View) => void;
}

export const useApp = create<AppState>((set) => ({
  // The marketing landing is the front door; the bookshelf is one click away.
  view: { name: "home" },
  setView: (view) => set({ view }),
}));
