import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { getDeck, getDeckPdf, recordReview } from "../db/repo";
import { buildQueue } from "../srs/queue";
import { loadPdf } from "../pdf/pdfEngine";
import {
  applyGrade,
  configureFsrs,
  preview,
  RATING_LABEL,
  UI_RATINGS,
  type UiRating,
} from "../srs/scheduler";
import { PageOverlay } from "../render/PageOverlay";
import { useApp } from "../store/session";
import type { CardRow, DeckRow } from "../types";

type Status = "loading" | "ready" | "empty" | "done" | "error";

const EMPTY_SET: ReadonlySet<string | number> = new Set();
const REVEALED_CARD: ReadonlySet<string | number> = new Set(["card"]);

export function Reviewer({ deckId }: { deckId: number }) {
  const setView = useApp((s) => s.setView);
  const [status, setStatus] = useState<Status>("loading");
  const [errMsg, setErrMsg] = useState("");
  const [deck, setDeck] = useState<DeckRow>();
  const [pageW, setPageW] = useState(0);
  const [queue, setQueue] = useState<CardRow[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const [docReady, setDocReady] = useState(false);
  const gradingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setDocReady(false);
    (async () => {
      try {
        const d = await getDeck(deckId);
        if (!d) throw new Error("デッキが見つかりません");
        const pdf = await getDeckPdf(deckId);
        if (!pdf) throw new Error("PDFが見つかりません");
        configureFsrs(d.requestRetention);
        const q = await buildQueue(d, Date.now());
        const doc = await loadPdf(pdf.blob);
        if (cancelled) {
          await doc.loadingTask.destroy();
          return;
        }
        docRef.current = doc;
        setDeck(d);
        setPageW(pdf.pageW);
        setQueue(q);
        setIndex(0);
        setRevealed(false);
        setReviewed(0);
        setDocReady(true);
        setStatus(q.length ? "ready" : "empty");
      } catch (e) {
        if (!cancelled) {
          setErrMsg(e instanceof Error ? e.message : String(e));
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
      const doc = docRef.current;
      docRef.current = null;
      void doc?.loadingTask.destroy();
    };
  }, [deckId]);

  const card = status === "ready" ? queue[index] : undefined;
  const previews = useMemo(() => (card ? preview(card, Date.now()) : null), [card]);

  const onGrade = async (rating: UiRating) => {
    if (!card || gradingRef.current) return; // guard against double-grade
    gradingRef.current = true;
    try {
      const now = Date.now();
      const applied = applyGrade(card, now, rating);
      await recordReview(card, applied, now);
      setReviewed((c) => c + 1);

      let nextQueue = queue;
      if (rating === 1) {
        // "もう一度": re-show this card later in the same session.
        nextQueue = [...queue];
        nextQueue.splice(Math.min(nextQueue.length, index + 3), 0, {
          ...card,
          ...applied.state,
        });
        setQueue(nextQueue);
      }

      const next = index + 1;
      if (next >= nextQueue.length) {
        setStatus("done");
      } else {
        setIndex(next);
        setRevealed(false);
      }
    } finally {
      gradingRef.current = false;
    }
  };

  // Keyboard: Space reveals (then grades Good); 1-4 grade once revealed.
  const keyState = {
    active: status === "ready" && !!card,
    revealed,
    reveal: () => setRevealed(true),
    grade: onGrade,
  };
  const keyRef = useRef(keyState);
  keyRef.current = keyState;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const k = keyRef.current;
      if (!k.active) return;
      if (e.key === " ") {
        e.preventDefault();
        if (!k.revealed) k.reveal();
        else void k.grade(3);
      } else if (k.revealed && ["1", "2", "3", "4"].includes(e.key)) {
        void k.grade(Number(e.key) as UiRating);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const back = () => setView({ name: "decks" });

  if (status === "loading") return <Centered>読み込み中…</Centered>;
  if (status === "error")
    return (
      <Centered>
        <p>エラー: {errMsg}</p>
        <button className="btn" onClick={back}>
          戻る
        </button>
      </Centered>
    );
  if (status === "empty")
    return (
      <Centered>
        <p className="done-title">今日の学習は完了です 🎉</p>
        <p className="muted">また後で新しいカードが出題されます。</p>
        <button className="btn primary" onClick={back}>
          デッキ一覧へ
        </button>
      </Centered>
    );
  if (status === "done")
    return (
      <Centered>
        <p className="done-title">セッション完了 🎉</p>
        <p className="muted">{reviewed} 枚を復習しました。</p>
        <button className="btn primary" onClick={back}>
          デッキ一覧へ
        </button>
      </Centered>
    );

  const doc = docRef.current;
  const total = queue.length;

  return (
    <div className="reviewer">
      <div className="review-bar">
        <button className="btn ghost sm" onClick={back}>
          終了
        </button>
        <span className="review-progress">
          {index + 1} / {total}
        </span>
        <span className="deck-name-sm">{deck?.name}</span>
      </div>

      {doc && docReady && card && (
        <PageOverlay
          doc={doc}
          pageIndex={card.pageIndex}
          pageW={pageW}
          groups={[{ id: "card", rects: card.rects.length ? card.rects : [card.answerRect] }]}
          revealedIds={revealed ? REVEALED_CARD : EMPTY_SET}
          onToggle={() => setRevealed((r) => !r)}
        />
      )}

      <div className="review-controls">
        {!revealed ? (
          <button className="btn primary big" onClick={() => setRevealed(true)}>
            答えを見る
          </button>
        ) : (
          <div className="grade-row">
            {UI_RATINGS.map((r) => (
              <button key={r} className={`btn grade g${r}`} onClick={() => onGrade(r)}>
                <span className="grade-label">{RATING_LABEL[r]}</span>
                <span className="grade-interval">{previews?.[r].intervalText}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="centered">{children}</div>;
}
