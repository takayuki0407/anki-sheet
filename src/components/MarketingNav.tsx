// Top navigation for the marketing pages (Home / Service / Pricing) — a Goodnotes-style bar that
// switches between the pages. (The in-app pages keep the minimal app topbar instead.)
import { useApp, type View } from "../store/session";
import { useAuth } from "../auth/useAuth";

const LINKS: { name: "home" | "service" | "pricing"; label: string }[] = [
  { name: "home", label: "ホーム" },
  { name: "service", label: "サービス" },
  { name: "pricing", label: "料金プラン" },
];

export function MarketingNav({ current }: { current: View["name"] }) {
  const setView = useApp((s) => s.setView);
  const user = useAuth((s) => s.user);
  return (
    <header className="mkt-nav">
      <button className="mkt-brand" onClick={() => setView({ name: "home" })}>
        Anki-sheet
      </button>
      <nav className="mkt-links">
        {LINKS.map((l) => (
          <button
            key={l.name}
            className={`mkt-link ${current === l.name ? "active" : ""}`}
            onClick={() => setView({ name: l.name })}
          >
            {l.label}
          </button>
        ))}
      </nav>
      <div className="mkt-actions">
        <button className="mkt-link" onClick={() => setView({ name: user ? "info" : "login" })}>
          {user ? "アカウント" : "ログイン"}
        </button>
        <button className="btn primary sm" onClick={() => setView({ name: "decks" })}>
          始める
        </button>
      </div>
    </header>
  );
}
