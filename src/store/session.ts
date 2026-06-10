import { create } from "zustand";

export type View =
  | { name: "home" }
  | { name: "decks" }
  | { name: "import" }
  | { name: "viewer"; deckId: number }
  | { name: "settings"; deckId: number }
  // `from` remembers where quiz was opened from so its back button returns there (opened from the
  // viewer → back to the book, not the bookshelf). In-memory only (not in the URL); defaults to decks.
  | { name: "quiz"; deckId: number; from?: View }
  | { name: "review" } // 今日の復習 (cross-book SM-2 session)
  | { name: "info" }
  | { name: "login" }
  | { name: "pricing" }
  | { name: "service" };

// ---- URL routing -------------------------------------------------------------------------------
// The app keeps its place in the browser URL so the marketing pages have real, shareable links
// (/, /service, /price) and the back/forward buttons work. The in-app pages live under /app.
// (Requires base:"/" in vite.config + a SPA fallback in public/_redirects so a direct hit / refresh
// on any of these paths still serves index.html.)

/** The canonical path for a view (no trailing slash). */
export function viewToPath(view: View): string {
  switch (view.name) {
    case "home":
      return "/";
    case "service":
      return "/service";
    case "pricing":
      return "/price";
    case "decks":
      return "/app";
    case "import":
      return "/app/import";
    case "viewer":
      return `/app/read/${view.deckId}`;
    case "settings":
      return `/app/settings/${view.deckId}`;
    case "quiz":
      return `/app/quiz/${view.deckId}`;
    case "review":
      return "/app/review";
    case "info":
      return "/info";
    case "login":
      return "/login";
  }
}

/** Parse a path back into a view (trailing slashes ignored; unknown paths → home). */
export function pathToView(path: string): View {
  const p = path.replace(/\/+$/, "") || "/";
  if (p === "/") return { name: "home" };
  if (p === "/service") return { name: "service" };
  if (p === "/price") return { name: "pricing" };
  if (p === "/app") return { name: "decks" };
  if (p === "/app/import") return { name: "import" };
  if (p === "/app/review") return { name: "review" };
  if (p === "/info") return { name: "info" };
  if (p === "/login") return { name: "login" };
  const read = p.match(/^\/app\/read\/(\d+)$/);
  if (read) return { name: "viewer", deckId: Number(read[1]) };
  const settings = p.match(/^\/app\/settings\/(\d+)$/);
  if (settings) return { name: "settings", deckId: Number(settings[1]) };
  const quiz = p.match(/^\/app\/quiz\/(\d+)$/);
  if (quiz) return { name: "quiz", deckId: Number(quiz[1]) };
  return { name: "home" };
}

const samePath = (a: string, b: string) => (a.replace(/\/+$/, "") || "/") === (b.replace(/\/+$/, "") || "/");

interface AppState {
  view: View;
  setView: (v: View) => void;
}

export const useApp = create<AppState>((set) => ({
  // Boot into whatever the URL points at (the marketing landing is the default / front door).
  view: typeof window !== "undefined" ? pathToView(window.location.pathname) : { name: "home" },
  setView: (view) => {
    if (typeof window !== "undefined") {
      const next = viewToPath(view);
      if (!samePath(window.location.pathname, next)) window.history.pushState({}, "", next);
    }
    set({ view });
  },
}));

// Reflect browser back/forward into the view (without pushing a new history entry).
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    useApp.setState({ view: pathToView(window.location.pathname) });
  });
}
