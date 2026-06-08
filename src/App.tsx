import { useEffect } from "react";
import { useApp } from "./store/session";
import { requestPersistentStorage } from "./db/backup";
import { initAuth } from "./auth/useAuth";
import { Home } from "./components/Home";
import { Service } from "./components/Service";
import { Pricing } from "./components/Pricing";
import { MarketingNav } from "./components/MarketingNav";
import { SiteFooter } from "./components/SiteFooter";
import { DeckList } from "./components/DeckList";
import { ImportWizard } from "./components/ImportWizard";
import { PageViewer } from "./components/PageViewer";
import { Settings } from "./components/Settings";
import { Info } from "./components/Info";
import { Login } from "./components/Login";

// The marketing site (Home / Service / Pricing) gets the nav + footer chrome; the app pages
// (bookshelf / viewer / …) get the minimal app topbar instead.
const MARKETING = new Set(["home", "service", "pricing"]);

export function App() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  useEffect(() => {
    void requestPersistentStorage();
    initAuth(); // start the Firebase auth listener
  }, []);
  const isMarketing = MARKETING.has(view.name);
  // The reader is full-screen: no app chrome above the page, maximizing vertical reading space.
  // The viewer renders its own back / controls row.
  const isViewer = view.name === "viewer";
  return (
    <div className={isMarketing ? "app marketing" : "app"}>
      {isMarketing ? (
        <MarketingNav current={view.name} />
      ) : isViewer ? null : (
        <header className="topbar">
          <button className="brand brand-btn" onClick={() => setView({ name: "decks" })}>
            <img src="/icon.svg" className="brand-icon" alt="" />
            Anki-sheet
          </button>
          <span className="brand-sub">赤シート暗記</span>
          {view.name !== "info" && (
            <button className="btn ghost sm topbar-info" onClick={() => setView({ name: "info" })}>
              アカウント・情報
            </button>
          )}
        </header>
      )}
      <main className="content">
        {view.name === "home" && <Home />}
        {view.name === "service" && <Service />}
        {view.name === "pricing" && <Pricing />}
        {view.name === "decks" && <DeckList />}
        {view.name === "import" && <ImportWizard />}
        {view.name === "viewer" && <PageViewer deckId={view.deckId} />}
        {view.name === "settings" && <Settings deckId={view.deckId} />}
        {view.name === "info" && <Info />}
        {view.name === "login" && <Login />}
      </main>
      {isMarketing && <SiteFooter />}
    </div>
  );
}
