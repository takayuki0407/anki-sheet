import { useEffect, useState } from "react";
import { useApp } from "./store/session";
import { requestPersistentStorage } from "./db/backup";
import { initAuth, useAuth } from "./auth/useAuth";
import { listBooks, type AccountBooks } from "./sync/api";
import { Home } from "./components/Home";
import { Service } from "./components/Service";
import { Pricing } from "./components/Pricing";
import { MarketingNav } from "./components/MarketingNav";
import { SiteFooter } from "./components/SiteFooter";
import { DeckList } from "./components/DeckList";
import { ImportWizard } from "./components/ImportWizard";
import { PageViewer } from "./components/PageViewer";
import { Settings } from "./components/Settings";
import { QuizScreen } from "./components/QuizScreen";
import { ReviewScreen } from "./components/ReviewScreen";
import { Info } from "./components/Info";
import { Login } from "./components/Login";
import { DowngradeSelect } from "./components/DowngradeSelect";
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
const APP_VIEWS = new Set(["decks", "import", "viewer", "settings", "quiz"]);

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
  // Account-wide downgrade-trim gate: the server flags `trimRequired` when a downgrade leaves the
  // account over its book cap; the user must trim down (pick the kept set) before using the app.
  // `tierTick` re-fetches after a trim so the gate clears. Guarded for PRIVATE so the coming-soon
  // build never touches the network.
  const [tierInfo, setTierInfo] = useState<AccountBooks | null>(null);
  const [tierTick, setTierTick] = useState(0);
  useEffect(() => {
    if (PRIVATE || !user) {
      setTierInfo(null);
      return;
    }
    let live = true;
    void listBooks()
      .then((u) => live && setTierInfo(u))
      .catch(() => live && setTierInfo(null)); // fail open — don't trap the user on a network error
    return () => {
      live = false;
    };
  }, [user, tierTick]);
  if (PRIVATE) return <ComingSoon />;
  const isMarketing = MARKETING.has(view.name);
  // Sign-in REQUIRED for the app pages (the bookshelf can't be used without an account).
  const needsLogin = APP_VIEWS.has(view.name) && authReady && !user;
  // Downgrade left the account over its cap → force the trim screen (not on the marketing pages).
  const overLimit = !!user && !isMarketing && !!tierInfo?.trimRequired;
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
            Kiokumate
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
        ) : overLimit ? (
          <DowngradeSelect
            keepLimit={tierInfo?.cap ?? tierInfo?.limit ?? 1}
            onResolved={() => setTierTick((n) => n + 1)}
          />
        ) : (
          <>
            {view.name === "home" && <Home />}
            {view.name === "service" && <Service />}
            {view.name === "pricing" && <Pricing />}
            {view.name === "decks" && <DeckList />}
            {view.name === "import" && <ImportWizard />}
            {view.name === "viewer" && <PageViewer deckId={view.deckId} />}
            {view.name === "settings" && <Settings deckId={view.deckId} />}
            {view.name === "quiz" && <QuizScreen deckId={view.deckId} from={view.from} />}
            {view.name === "review" && <ReviewScreen />}
            {view.name === "info" && <Info />}
            {view.name === "login" && <Login />}
          </>
        )}
      </main>
      {isMarketing && <SiteFooter />}
    </div>
  );
}
