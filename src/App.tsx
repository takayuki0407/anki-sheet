import { useEffect } from "react";
import { useApp } from "./store/session";
import { requestPersistentStorage } from "./db/backup";
import { DeckList } from "./components/DeckList";
import { ImportWizard } from "./components/ImportWizard";
import { Reviewer } from "./components/Reviewer";
import { PageViewer } from "./components/PageViewer";
import { Settings } from "./components/Settings";

export function App() {
  const view = useApp((s) => s.view);
  useEffect(() => {
    void requestPersistentStorage();
  }, []);
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Anki-sheet</span>
        <span className="brand-sub">赤シート暗記</span>
      </header>
      <main className="content">
        {view.name === "decks" && <DeckList />}
        {view.name === "import" && <ImportWizard />}
        {view.name === "review" && <Reviewer deckId={view.deckId} />}
        {view.name === "viewer" && <PageViewer deckId={view.deckId} />}
        {view.name === "settings" && <Settings deckId={view.deckId} />}
      </main>
    </div>
  );
}
