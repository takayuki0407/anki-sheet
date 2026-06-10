// 今日の復習 (Premium) — one cross-book SM-2 session: every question whose review is due
// (dueAt <= now), most-overdue first. Reached from the bookshelf card. The server keeps the
// review SYNC Premium-only; this screen additionally locks the UI for known non-premium tiers
// (unknown/offline falls open so an offline Premium user isn't punished).
import { useEffect, useState } from "react";
import { useApp } from "../store/session";
import { dueReviews, questionsByIds } from "../db/repo";
import { getGenUsage } from "../ai/generate";
import { SolveSession } from "./SolveSession";
import type { QuestionRow } from "../types";

export function ReviewScreen() {
  const setView = useApp((s) => s.setView);
  const [questions, setQuestions] = useState<QuestionRow[] | null>(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    let live = true;
    void getGenUsage()
      .then((u) => {
        if (live && u.tier !== "premium" && u.tier !== "admin") setLocked(true);
      })
      .catch(() => {}); // unknown → fall open
    void (async () => {
      const due = await dueReviews(Date.now());
      const qs = await questionsByIds(due.map((r) => r.questionId));
      // Keep the due order (most overdue first) — questionsByIds preserves input order.
      if (live) setQuestions(qs);
    })();
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="panel quiz">
      <div className="panel-head">
        <button className="btn ghost" onClick={() => setView({ name: "decks" })}>
          ← 本棚へ
        </button>
        <h2>今日の復習</h2>
      </div>
      {locked ? (
        <div className="empty">
          <p>
            「今日の復習」はPremiumの機能です。
            <br />
            間違えやすい問題を、忘れる直前の最適なタイミングで再出題します。
          </p>
          <p className="muted small">プランの変更は現在iOSアプリから行えます。</p>
        </div>
      ) : questions === null ? (
        <p className="muted">読み込み中…</p>
      ) : !questions.length ? (
        <div className="empty">
          <p>いま復習が必要な問題はありません 🎉</p>
          <button className="btn ghost" onClick={() => setView({ name: "decks" })}>
            本棚へ戻る
          </button>
        </div>
      ) : (
        <SolveSession questions={questions} onExit={() => setView({ name: "decks" })} />
      )}
    </div>
  );
}
