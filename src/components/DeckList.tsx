import { useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { deckCounts, deleteDeck, listDecks } from "../db/repo";
import { exportBackup, downloadBlob, importBackup } from "../db/backup";
import { useApp } from "../store/session";
import type { DeckRow } from "../types";

function dateStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

export function DeckList() {
  const setView = useApp((s) => s.setView);
  const decks = useLiveQuery(() => listDecks(), []);
  const importRef = useRef<HTMLInputElement>(null);

  const onExport = async () => {
    const blob = await exportBackup();
    downloadBlob(blob, `anki-sheet-backup-${dateStamp()}.json`);
  };

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!confirm("バックアップを読み込み、現在のすべてのデータを置き換えます。よろしいですか？")) return;
    try {
      await importBackup(f);
      alert("復元しました。");
    } catch (err) {
      alert("読み込みに失敗しました: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>デッキ</h2>
        <button className="btn primary" onClick={() => setView({ name: "import" })}>
          ＋ PDFを取り込む
        </button>
      </div>

      <div className="tools-row">
        <button className="btn ghost sm" onClick={onExport} disabled={!decks?.length}>
          バックアップを書き出す
        </button>
        <button className="btn ghost sm" onClick={() => importRef.current?.click()}>
          バックアップを読み込む
        </button>
        <input ref={importRef} type="file" accept="application/json" hidden onChange={onImportFile} />
      </div>

      {decks === undefined && <p className="muted">読み込み中…</p>}
      {decks && decks.length === 0 && (
        <div className="empty">
          <p>まだデッキがありません。</p>
          <p className="muted">赤シート対応のPDFを取り込んで始めましょう。</p>
        </div>
      )}

      <ul className="deck-list">
        {decks?.map((d) => (
          <DeckCard key={d.id} deck={d} />
        ))}
      </ul>
    </div>
  );
}

function DeckCard({ deck }: { deck: DeckRow }) {
  const setView = useApp((s) => s.setView);
  const counts = useLiveQuery(() => deckCounts(deck.id!, Date.now()), [deck.id]);

  const onDelete = async () => {
    if (confirm(`「${deck.name}」を削除しますか？（学習の進捗も消えます）`)) {
      await deleteDeck(deck.id!);
    }
  };

  const due = counts?.due ?? 0;
  const newTotal = counts?.newTotal ?? 0;
  const studyable = due + newTotal > 0;

  return (
    <li className="deck-card">
      <div className="deck-main" onClick={() => setView({ name: "review", deckId: deck.id! })}>
        <div className="deck-name">{deck.name}</div>
        <div className="deck-counts">
          <span className="chip total">{counts?.total ?? "…"}枚</span>
          <span className="chip due">復習 {due}</span>
          <span className="chip new">新規 {newTotal}</span>
        </div>
      </div>
      <div className="deck-actions">
        <button
          className="btn primary sm"
          disabled={!studyable}
          onClick={() => setView({ name: "review", deckId: deck.id! })}
        >
          学習
        </button>
        <button
          className="btn sm"
          onClick={() => setView({ name: "viewer", deckId: deck.id! })}
        >
          めくる
        </button>
        <button
          className="btn ghost sm"
          onClick={() => setView({ name: "settings", deckId: deck.id! })}
        >
          設定
        </button>
        <button className="btn ghost sm" onClick={onDelete}>
          削除
        </button>
      </div>
    </li>
  );
}
