import { useEffect } from "react";
import { useApp } from "./store/session";
import { requestPersistentStorage } from "./db/backup";
import { initAuth, useAuth } from "./auth/useAuth";
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
import { ComingSoon } from "./components/ComingSoon";

// The marketing site (Home / Service / Pricing) gets the nav + footer chrome; the app pages
// (bookshelf / viewer / …) get the minimal app topbar instead.
const MARKETING = new Set(["home", "service", "pricing"]);

// Not publicly launched yet. FAIL-CLOSED: the app renders only a coming-soon page UNLESS the build
// explicitly opts in via VITE_PUBLIC=true (`npm run build:public`). So a plain `npm run build`
// (the production deploy) is private by default — you can't accidentally expose the app before web
// billing exists. The /api/* sync backend (Pages Functions) is separate and always served.
const PRIVATE = import.meta.env.VITE_PUBLIC !== "true";

// App pages (vs marketing/login/info) require sign-in.
const APP_VIEWS = new Set(["decks", "import", "viewer", "settings"]);

export function App() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const user = useAuth((s) => s.user);
  const authReady = useAuth((s) => s.ready);
  useEffect(() => {
    if (PRIVATE) return; // don't start auth/storage on the coming-soon page
    void requestPersistentStorage();
    initAuth(); // start the Firebase auth listener
  }, []);
  if (PRIVATE) return <ComingSoon />;
  const isMarketing = MARKETING.has(view.name);
  // Sign-in REQUIRED for the app pages (the bookshelf can't be used without an account).
  const needsLogin = APP_VIEWS.has(view.name) && authReady && !user;
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
          {view.name !== "info" && (
            <button className="btn ghost sm topbar-info" onClick={() => setView({ name: "info" })}>
              情報・ヘルプ
            </button>
          )}
        </header>
      )}
      <main className="content">
        {needsLogin ? (
          <Login />
        ) : (
          <>
            {view.name === "home" && <Home />}
            {view.name === "service" && <Service />}
            {view.name === "pricing" && <Pricing />}
            {view.name === "decks" && <DeckList />}
            {view.name === "import" && <ImportWizard />}
            {view.name === "viewer" && <PageViewer deckId={view.deckId} />}
            {view.name === "settings" && <Settings deckId={view.deckId} />}
            {view.name === "info" && <Info />}
            {view.name === "login" && <Login />}
          </>
        )}
      </main>
      {isMarketing && <SiteFooter />}
    </div>
  );
}
