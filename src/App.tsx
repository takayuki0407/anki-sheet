import { useEffect } from "react";
import { useApp } from "./store/session";
import { requestPersistentStorage } from "./db/backup";
import { Home } from "./components/Home";
import { DeckList } from "./components/DeckList";
import { ImportWizard } from "./components/ImportWizard";
import { PageViewer } from "./components/PageViewer";
import { Settings } from "./components/Settings";
import { Info } from "./components/Info";

export function App() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  useEffect(() => {
    void requestPersistentStorage();
  }, []);
  return (
    <div className="app">
      <header className="topbar">
        <button className="brand brand-btn" onClick={() => setView({ name: "home" })}>
          Anki-sheet
        </button>
        <span className="brand-sub">赤シート暗記</span>
        <button className="btn ghost sm topbar-info" onClick={() => setView({ name: "info" })}>
          情報
        </button>
      </header>
      <main className="content">
        {view.name === "home" && <Home />}
        {view.name === "decks" && <DeckList />}
        {view.name === "import" && <ImportWizard />}
        {view.name === "viewer" && <PageViewer deckId={view.deckId} />}
        {view.name === "settings" && <Settings deckId={view.deckId} />}
        {view.name === "info" && <Info />}
      </main>
    </div>
  );
}
