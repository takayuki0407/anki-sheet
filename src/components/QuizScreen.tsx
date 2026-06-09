// Per-deck AI ○× quiz screen. Two tabs:
//   演習 (solve) — work through the questions already generated for this book.
//   生成 (generate) — pick pages (with page previews) — one, a range, or many — and generate their
//                     ○× questions in bulk. Generation is manual and consumes the monthly page
//                     budget (1 per newly-generated page); already-generated pages are skipped.
import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useLiveQuery } from "dexie-react-hooks";
import { useApp, type View } from "../store/session";
import { useAuth } from "../auth/useAuth";
import { deckCards, getBookQuestions, getDeck, getDeckPdf } from "../db/repo";
import { getPageText, loadPdf, renderPageImage } from "../pdf/pdfEngine";
import {
  AiUnavailableError,
  QuotaError,
  generatePage,
  getGenUsage,
  restoreCloudQuestions,
  type Density,
  type GenUsage,
} from "../ai/generate";
import { ensureAiConsent } from "../ai/consent";
import type { DeckRow, QuestionRow } from "../types";

const DENSITY_LABELS: { key: Density; label: string }[] = [
  { key: "auto", label: "おまかせ" },
  { key: "few", label: "少なめ" },
  { key: "normal", label: "標準" },
  { key: "many", label: "多め" },
];

export function QuizScreen({ deckId, from }: { deckId: number; from?: View }) {
  const setView = useApp((s) => s.setView);
  const user = useAuth((s) => s.user);
  const [deck, setDeck] = useState<DeckRow | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [termsByPage, setTermsByPage] = useState<Map<number, string[]>>(new Map());
  const [usage, setUsage] = useState<GenUsage | null>(null);
  const [tab, setTab] = useState<"solve" | "generate">("solve");

  // Load the deck, its PDF (for page text + previews), and its marked terms per page.
  useEffect(() => {
    let live = true;
    let openDoc: PDFDocumentProxy | null = null;
    (async () => {
      const d = await getDeck(deckId);
      const pdf = await getDeckPdf(deckId);
      const cards = await deckCards(deckId);
      if (!live) return;
      setDeck(d ?? null);
      setPageCount(pdf?.pageCount ?? 0);
      const m = new Map<number, string[]>();
      for (const c of cards) {
        if (!c.text?.trim()) continue;
        const arr = m.get(c.pageIndex) ?? [];
        arr.push(c.text);
        m.set(c.pageIndex, arr);
      }
      setTermsByPage(m);
      if (pdf?.blob) {
        try {
          openDoc = await loadPdf(pdf.blob);
          if (live) setDoc(openDoc);
          else void openDoc.loadingTask.destroy();
        } catch {
          /* previews/generation unavailable if the PDF can't open */
        }
      }
    })();
    return () => {
      live = false;
      void openDoc?.loadingTask.destroy();
    };
  }, [deckId]);

  const bookId = deck?.bookId;
  const questions =
    useLiveQuery(() => (bookId ? getBookQuestions(bookId) : Promise.resolve([])), [bookId]) ?? [];
  const countsByPage = useMemo(() => {
    const m = new Map<number, number>();
    for (const q of questions) m.set(q.pageIndex, (m.get(q.pageIndex) ?? 0) + 1);
    return m;
  }, [questions]);

  const refreshUsage = useRef(() => {
    void getGenUsage()
      .then(setUsage)
      .catch(() => {});
  }).current;

  // Pull cloud questions (Pro+) once, then load the quota.
  useEffect(() => {
    if (!bookId || !user) return;
    void restoreCloudQuestions(bookId).catch(() => {});
    refreshUsage();
  }, [bookId, user, refreshUsage]);

  return (
    <div className="panel quiz">
      <div className="panel-head">
        <button className="btn ghost" onClick={() => setView(from ?? { name: "decks" })}>
          ← 戻る
        </button>
        <h2>AI問題 — {deck?.name ?? "…"}</h2>
      </div>

      <div className="quiz-quota">
        {usage ? (
          usage.unlimited ? (
            <span>今月の生成：{usage.count} ページ（無制限）</span>
          ) : (
            <span>
              今月の生成枠：残り <strong>{usage.remaining}</strong> / {usage.limit} ページ
            </span>
          )
        ) : (
          <span className="muted">枠を確認中…</span>
        )}
      </div>

      <div className="quiz-tabs">
        <button className={`btn sm ${tab === "solve" ? "primary" : ""}`} onClick={() => setTab("solve")}>
          演習（{questions.length}問）
        </button>
        <button
          className={`btn sm ${tab === "generate" ? "primary" : ""}`}
          onClick={() => setTab("generate")}
        >
          問題を作る
        </button>
      </div>

      {tab === "solve" ? (
        <SolveTab questions={questions} onGenerate={() => setTab("generate")} />
      ) : (
        <GenerateTab
          bookId={bookId}
          doc={doc}
          pageCount={pageCount}
          termsByPage={termsByPage}
          countsByPage={countsByPage}
          usage={usage}
          defaultHint={deck?.name ?? ""}
          onGenerated={refreshUsage}
        />
      )}
    </div>
  );
}

// ---- 生成タブ ----------------------------------------------------------------------------------

interface GenProgress {
  done: number;
  total: number;
  page: number;
}

function GenerateTab({
  bookId,
  doc,
  pageCount,
  termsByPage,
  countsByPage,
  usage,
  defaultHint,
  onGenerated,
}: {
  bookId: string | undefined;
  doc: PDFDocumentProxy | null;
  pageCount: number;
  termsByPage: Map<number, string[]>;
  countsByPage: Map<number, number>;
  usage: GenUsage | null;
  defaultHint: string;
  onGenerated: () => void;
}) {
  const [density, setDensity] = useState<Density>("auto");
  const [hint, setHint] = useState(defaultHint);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [progress, setProgress] = useState<GenProgress | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Pages that have marked terms (only these can produce questions), ascending.
  const pages = useMemo(() => [...termsByPage.keys()].sort((a, b) => a - b), [termsByPage]);

  const toggle = (p: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const applyRange = () => {
    const a = parseInt(rangeFrom, 10);
    const b = parseInt(rangeTo, 10);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return;
    const lo = Math.min(a, b) - 1; // UI is 1-based, pageIndex is 0-based
    const hi = Math.max(a, b) - 1;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of pages) if (p >= lo && p <= hi) next.add(p);
      return next;
    });
  };

  // Only ungenerated selected pages cost quota; already-generated ones are skipped (use 再生成 per page).
  const toGenerate = useMemo(
    () => [...selected].filter((p) => !(countsByPage.get(p) ?? 0)).sort((a, b) => a - b),
    [selected, countsByPage],
  );

  const run = async () => {
    if (!bookId || !doc || !toGenerate.length || progress) return;
    if (!ensureAiConsent()) return; // one-time opt-in: generation sends page text to the server/AI
    setMsg(null);
    const errors: number[] = [];
    let done = 0;
    for (const p of toGenerate) {
      setProgress({ done, total: toGenerate.length, page: p });
      const terms = termsByPage.get(p) ?? [];
      if (!terms.length) continue;
      try {
        const text = await getPageText(doc, p);
        if (!text.trim()) {
          errors.push(p);
          continue;
        }
        await generatePage({ bookId, pageIndex: p, pageText: text, markedTerms: terms, density, subjectHint: hint, regenerate: false });
        done++;
        onGenerated();
      } catch (e) {
        if (e instanceof QuotaError) {
          setMsg(`今月の生成枠を使い切りました（${e.limit}ページ）。来月またご利用いただくか、上位プランをご検討ください。`);
          break;
        }
        if (e instanceof AiUnavailableError) {
          setMsg("AI生成が未設定です（サーバの APIキー）。少し時間をおいてお試しください。");
          break;
        }
        errors.push(p);
      }
    }
    setProgress(null);
    setSelected(new Set());
    onGenerated();
    if (!msg) {
      const parts = [`${done}ページ分の問題を作成しました。`];
      if (errors.length) parts.push(`${errors.length}ページは本文が取得できず作成できませんでした。`);
      setMsg(parts.join(""));
    }
  };

  if (!bookId)
    return <p className="muted">この本はまだアカウントに登録されていません（取り込み直すと有効になります）。</p>;

  const remaining = usage && !usage.unlimited ? usage.remaining : Infinity;
  const willHitQuota = toGenerate.length > remaining;

  return (
    <div className="quiz-generate">
      <div className="gen-controls">
        <div className="gen-row">
          <span className="gen-label">問題の量</span>
          <div className="preset-row">
            {DENSITY_LABELS.map((d) => (
              <button
                key={d.key}
                className={`btn sm ${density === d.key ? "primary" : ""}`}
                onClick={() => setDensity(d.key)}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
        <div className="gen-row">
          <label className="gen-label" htmlFor="subj">
            科目ヒント
          </label>
          <input id="subj" className="gen-hint" value={hint} onChange={(e) => setHint(e.target.value)} placeholder="任意（例：日本史B）" />
        </div>
        <div className="gen-row">
          <span className="gen-label">ページ範囲</span>
          <div className="range-row">
            <input className="range-num" type="number" min={1} max={pageCount} value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} placeholder="開始" />
            <span>〜</span>
            <input className="range-num" type="number" min={1} max={pageCount} value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} placeholder="終了" />
            <button className="btn sm" onClick={applyRange}>範囲を選択</button>
            <button className="btn ghost sm" onClick={() => setSelected(new Set())} disabled={!selected.size}>
              クリア
            </button>
          </div>
        </div>
      </div>

      <p className="muted small">
        暗記箇所のあるページのみ表示しています（{pages.length}ページ）。チェックして「まとめて生成」。
        生成済みページは枠を消費しません。
      </p>

      <div className="page-picker">
        {pages.map((p) => (
          <PageCard
            key={p}
            doc={doc}
            pageIndex={p}
            terms={termsByPage.get(p)?.length ?? 0}
            generated={countsByPage.get(p) ?? 0}
            selected={selected.has(p)}
            onToggle={() => toggle(p)}
          />
        ))}
      </div>

      <div className="gen-footer">
        {progress ? (
          <span>生成中… {progress.done}/{progress.total}（ページ {progress.page + 1}）</span>
        ) : (
          <button className="btn primary" disabled={!toGenerate.length || !doc} onClick={() => void run()}>
            選んだ {toGenerate.length} ページをまとめて生成
          </button>
        )}
        {willHitQuota && !progress ? (
          <span className="quiz-warn small">残り枠 {remaining} ページを超える分は生成されません。</span>
        ) : null}
      </div>
      {msg ? <p className="quiz-msg">{msg}</p> : null}
    </div>
  );
}

/** A page preview card in the picker — lazily renders its thumbnail when scrolled into view. */
function PageCard({
  doc,
  pageIndex,
  terms,
  generated,
  selected,
  onToggle,
}: {
  doc: PDFDocumentProxy | null;
  pageIndex: number;
  terms: number;
  generated: number;
  selected: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!doc) return;
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    let objUrl: string | null = null;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        io.disconnect();
        void renderPageImage(doc, pageIndex, 180)
          .then((blob) => {
            if (cancelled) return;
            objUrl = URL.createObjectURL(blob);
            setUrl(objUrl);
          })
          .catch(() => {});
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [doc, pageIndex]);

  return (
    <button ref={ref} className={`page-card${selected ? " sel" : ""}`} onClick={onToggle}>
      <div className="page-thumb">
        {url ? <img src={url} alt={`${pageIndex + 1}ページ`} loading="lazy" /> : <span className="muted small">…</span>}
        {selected ? <span className="page-check">✓</span> : null}
      </div>
      <div className="page-card-meta">
        <span>P.{pageIndex + 1}</span>
        <span className="muted small">{generated ? `✓${generated}問` : `暗記${terms}`}</span>
      </div>
    </button>
  );
}

// ---- 演習タブ ----------------------------------------------------------------------------------

function SolveTab({ questions, onGenerate }: { questions: QuestionRow[]; onGenerate: () => void }) {
  const [session, setSession] = useState<QuestionRow[] | null>(null);

  const byPage = useMemo(() => {
    const m = new Map<number, QuestionRow[]>();
    for (const q of questions) {
      const arr = m.get(q.pageIndex) ?? [];
      arr.push(q);
      m.set(q.pageIndex, arr);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [questions]);

  if (session) return <SolveSession questions={session} onExit={() => setSession(null)} />;

  if (!questions.length)
    return (
      <div className="empty">
        <p>まだ問題がありません。</p>
        <button className="btn primary" onClick={onGenerate}>
          問題を作る
        </button>
      </div>
    );

  // Shuffle deterministically per render set order isn't critical; keep page order for "全問".
  return (
    <div className="solve-list">
      <button className="btn primary solve-all" onClick={() => setSession(questions)}>
        全問を解く（{questions.length}問）
      </button>
      <ul className="solve-pages">
        {byPage.map(([page, qs]) => (
          <li key={page}>
            <button className="solve-page-btn" onClick={() => setSession(qs)}>
              <span>P.{page + 1}</span>
              <span className="muted small">{qs.length}問</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SolveSession({ questions, onExit }: { questions: QuestionRow[]; onExit: () => void }) {
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<"正" | "誤" | null>(null);
  const [correct, setCorrect] = useState(0);
  const q = questions[i];
  const done = i >= questions.length;

  if (done)
    return (
      <div className="solve-done">
        <h3>おつかれさまでした</h3>
        <p>
          正解 <strong>{correct}</strong> / {questions.length}
        </p>
        <div className="solve-done-actions">
          <button
            className="btn primary"
            onClick={() => {
              setI(0);
              setPicked(null);
              setCorrect(0);
            }}
          >
            もう一度
          </button>
          <button className="btn ghost" onClick={onExit}>
            一覧へ戻る
          </button>
        </div>
      </div>
    );

  const pick = (a: "正" | "誤") => {
    if (picked) return;
    setPicked(a);
    if (a === q.answer) setCorrect((c) => c + 1);
  };
  const next = () => {
    setPicked(null);
    setI((n) => n + 1);
  };
  const isRight = picked === q.answer;

  return (
    <div className="solve-session">
      <div className="solve-progress muted small">
        {i + 1} / {questions.length}（P.{q.pageIndex + 1}）
        <button className="linklike" onClick={onExit}>
          中断
        </button>
      </div>
      <p className="solve-statement">{q.statement}</p>
      {!picked ? (
        <div className="solve-choices">
          <button className="btn maru" onClick={() => pick("正")}>
            ○ 正しい
          </button>
          <button className="btn batsu" onClick={() => pick("誤")}>
            × 誤り
          </button>
        </div>
      ) : (
        <div className="solve-reveal">
          <p className={`solve-verdict ${isRight ? "right" : "wrong"}`}>
            {isRight ? "正解！" : "不正解"} — この文は「{q.answer}」
          </p>
          {q.explanation ? <p className="solve-explain">{q.explanation}</p> : null}
          {q.source ? <p className="muted small">根拠：{q.source}</p> : null}
          <button className="btn primary" onClick={next}>
            次へ
          </button>
        </div>
      )}
    </div>
  );
}
