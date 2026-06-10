// Per-deck AI quiz screen. Three tabs:
//   演習 (practice)  — settings sheet (種類/範囲/出題) → SolveSession. Every answer is recorded
//                      (SM-2), so 間違いのみ復習 works on all plans and 今日の復習 on Premium.
//   問題一覧 (list)  — browse generated questions grouped by page × type; per-group practice /
//                      regenerate / delete.
//   問題を作る (gen) — pick the question TYPE (○×/4択) + pages and generate in bulk, with a
//                      progress panel + per-page status overlays. One generation = page × type.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useLiveQuery } from "dexie-react-hooks";
import { useApp, type View } from "../store/session";
import { useAuth } from "../auth/useAuth";
import {
  deckCards,
  deleteQuestionGroup,
  getBookQuestions,
  getBookReviews,
  getDeck,
  getDeckPdf,
} from "../db/repo";
import { getPageText, loadPdf, renderPageImage } from "../pdf/pdfEngine";
import {
  AiUnavailableError,
  QuotaError,
  deleteCloudQuestions,
  generatePage,
  getGenUsage,
  restoreCloudQuestions,
  type Density,
  type GenUsage,
} from "../ai/generate";
import { ensureAiConsent } from "../ai/consent";
import { syncReviews } from "../sync/reviews";
import { SolveSession } from "./SolveSession";
import type { DeckRow, QuestionRow, Qtype, ReviewRow } from "../types";

const DENSITY_LABELS: { key: Density; label: string }[] = [
  { key: "auto", label: "おまかせ" },
  { key: "few", label: "少なめ" },
  { key: "normal", label: "標準" },
  { key: "many", label: "多め" },
];

const QTYPE_LABELS: { key: Qtype; label: string }[] = [
  { key: "tf", label: "○×問題" },
  { key: "mc4", label: "4択問題" },
];
export const qtypeShort = (t: Qtype) => (t === "mc4" ? "4択" : "○×");

type PageFilter = "all" | "todo" | "done";
const PAGE_FILTERS: { key: PageFilter; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "todo", label: "未生成" },
  { key: "done", label: "生成済み" },
];

const QTYPE_PREF_KEY = "kk.genQtype";
const CONTEXT_CHARS = 700;

/** Page-text getter with a per-instance cache (a page fetched as a neighbor isn't re-extracted). */
function makePageTextGetter(doc: PDFDocumentProxy, pageCount: number) {
  const cache = new Map<number, string>();
  return async (idx: number): Promise<string> => {
    if (idx < 0 || idx >= pageCount) return "";
    const hit = cache.get(idx);
    if (hit !== undefined) return hit;
    let t = "";
    try {
      t = await getPageText(doc, idx);
    } catch {
      t = "";
    }
    cache.set(idx, t);
    return t;
  };
}

export function QuizScreen({ deckId, from }: { deckId: number; from?: View }) {
  const setView = useApp((s) => s.setView);
  const user = useAuth((s) => s.user);
  const [deck, setDeck] = useState<DeckRow | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [termsByPage, setTermsByPage] = useState<Map<number, string[]>>(new Map());
  const [usage, setUsage] = useState<GenUsage | null>(null);
  const [tab, setTab] = useState<"solve" | "list" | "generate">("solve");
  const [reviews, setReviews] = useState<Map<string, ReviewRow>>(new Map());
  // Questions handed from the generate tab's "演習をはじめる" (the freshly created set).
  const [pendingSession, setPendingSession] = useState<QuestionRow[] | null>(null);

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
        const arr = m.get(c.pageIndex) ?? [];
        if (c.text?.trim()) arr.push(c.text);
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

  const refreshReviews = useCallback(() => {
    if (!bookId) return;
    void getBookReviews(bookId).then(setReviews);
  }, [bookId]);
  useEffect(refreshReviews, [refreshReviews, questions.length]);

  const refreshUsage = useRef(() => {
    void getGenUsage()
      .then(setUsage)
      .catch(() => {});
  }).current;

  // Pull cloud questions + review records (Pro+/Premium) once, then the quota.
  useEffect(() => {
    if (!bookId || !user) return;
    void (async () => {
      await restoreCloudQuestions(bookId).catch(() => {});
      const qs = await getBookQuestions(bookId);
      await syncReviews(new Map(qs.map((q) => [q.id, q.bookId])));
      refreshReviews();
    })();
    refreshUsage();
  }, [bookId, user, refreshUsage, refreshReviews]);

  const premium = usage?.tier === "premium" || usage?.tier === "admin";

  const startPractice = (rows: QuestionRow[]) => {
    setPendingSession(rows);
    setTab("solve");
  };

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
            <span>今月の生成：{usage.count} 回（無制限）</span>
          ) : (
            <span>
              今月の生成枠：残り <strong>{usage.remaining}</strong> / {usage.limit} 回
            </span>
          )
        ) : (
          <span className="muted">枠を確認中…</span>
        )}
      </div>

      <div className="quiz-tabs">
        <button className={`btn sm ${tab === "solve" ? "primary" : ""}`} onClick={() => setTab("solve")}>
          演習
        </button>
        <button className={`btn sm ${tab === "list" ? "primary" : ""}`} onClick={() => setTab("list")}>
          問題一覧（{questions.length}）
        </button>
        <button
          className={`btn sm ${tab === "generate" ? "primary" : ""}`}
          onClick={() => setTab("generate")}
        >
          問題を作る
        </button>
      </div>

      {tab === "solve" ? (
        <PracticeTab
          questions={questions}
          reviews={reviews}
          premium={premium}
          pageCount={pageCount}
          pendingSession={pendingSession}
          clearPending={() => setPendingSession(null)}
          onAnswered={refreshReviews}
          onGenerate={() => setTab("generate")}
        />
      ) : tab === "list" ? (
        <ListTab
          questions={questions}
          doc={doc}
          pageCount={pageCount}
          bookId={bookId}
          termsByPage={termsByPage}
          onChanged={refreshUsage}
          onPractice={startPractice}
        />
      ) : (
        <GenerateTab
          bookId={bookId}
          doc={doc}
          pageCount={pageCount}
          termsByPage={termsByPage}
          questions={questions}
          usage={usage}
          defaultHint={deck?.name ?? ""}
          onGenerated={refreshUsage}
          onPractice={startPractice}
        />
      )}
    </div>
  );
}

// ---- 演習タブ（開始設定 → セッション） ---------------------------------------------------------

type PracticeType = "tf" | "mc4" | "both";
type PracticeMode = "all" | "wrong" | "due";

function PracticeTab({
  questions,
  reviews,
  premium,
  pageCount,
  pendingSession,
  clearPending,
  onAnswered,
  onGenerate,
}: {
  questions: QuestionRow[];
  reviews: Map<string, ReviewRow>;
  premium: boolean;
  pageCount: number;
  pendingSession: QuestionRow[] | null;
  clearPending: () => void;
  onAnswered: () => void;
  onGenerate: () => void;
}) {
  const [ptype, setPtype] = useState<PracticeType>("both");
  const [mode, setMode] = useState<PracticeMode>("all");
  const [useRange, setUseRange] = useState(false);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [session, setSession] = useState<QuestionRow[] | null>(null);

  const now = Date.now();
  const matches = useCallback(
    (t: PracticeType, m: PracticeMode) => {
      let list = questions.filter((q) => t === "both" || q.qtype === t);
      if (useRange) {
        const a = parseInt(rangeFrom, 10);
        const b = parseInt(rangeTo, 10);
        if (Number.isFinite(a) && Number.isFinite(b)) {
          const lo = Math.min(a, b) - 1;
          const hi = Math.max(a, b) - 1;
          list = list.filter((q) => q.pageIndex >= lo && q.pageIndex <= hi);
        }
      }
      if (m === "wrong") list = list.filter((q) => reviews.get(q.id)?.lastOk === 0);
      if (m === "due") {
        list = list
          .filter((q) => {
            const r = reviews.get(q.id);
            return !!r && r.dueAt <= now;
          })
          .sort((a, b) => reviews.get(a.id)!.dueAt - reviews.get(b.id)!.dueAt);
      } else {
        list = list.slice().sort((a, b) => a.pageIndex - b.pageIndex || a.createdAt - b.createdAt);
      }
      return list;
    },
    [questions, reviews, useRange, rangeFrom, rangeTo, now],
  );

  if (pendingSession)
    return (
      <SolveSession questions={pendingSession} onExit={clearPending} onAnswered={onAnswered} />
    );
  if (session)
    return <SolveSession questions={session} onExit={() => setSession(null)} onAnswered={onAnswered} />;

  if (!questions.length)
    return (
      <div className="empty">
        <p>まだ問題がありません。</p>
        <button className="btn primary" onClick={onGenerate}>
          問題を作る
        </button>
      </div>
    );

  const target = matches(ptype, mode);
  const wrongCount = matches(ptype, "wrong").length;
  const dueCount = matches(ptype, "due").length;

  return (
    <div className="practice-setup">
      <div className="gen-row">
        <span className="gen-label">種類</span>
        <div className="preset-row">
          {(
            [
              { key: "both", label: "両方ミックス" },
              { key: "tf", label: "○×のみ" },
              { key: "mc4", label: "4択のみ" },
            ] as { key: PracticeType; label: string }[]
          ).map((t) => (
            <button
              key={t.key}
              className={`btn sm ${ptype === t.key ? "primary" : ""}`}
              onClick={() => setPtype(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="gen-row">
        <span className="gen-label">範囲</span>
        <div className="preset-row">
          <button className={`btn sm ${!useRange ? "primary" : ""}`} onClick={() => setUseRange(false)}>
            全ページ
          </button>
          <button className={`btn sm ${useRange ? "primary" : ""}`} onClick={() => setUseRange(true)}>
            ページ範囲
          </button>
          {useRange ? (
            <span className="range-row">
              <input className="range-num" type="number" min={1} max={pageCount} value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} placeholder="開始" />
              <span>〜</span>
              <input className="range-num" type="number" min={1} max={pageCount} value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} placeholder="終了" />
            </span>
          ) : null}
        </div>
      </div>

      <div className="gen-row">
        <span className="gen-label">出題</span>
        <div className="preset-row">
          <button className={`btn sm ${mode === "all" ? "primary" : ""}`} onClick={() => setMode("all")}>
            すべて
          </button>
          <button className={`btn sm ${mode === "wrong" ? "primary" : ""}`} onClick={() => setMode("wrong")}>
            間違えた問題だけ（{wrongCount}）
          </button>
          {premium ? (
            <button className={`btn sm ${mode === "due" ? "primary" : ""}`} onClick={() => setMode("due")}>
              今日の復習（{dueCount}）
            </button>
          ) : (
            <button
              className="btn sm locked"
              onClick={() =>
                alert(
                  "「今日の復習」はPremiumの機能です。間違えやすい問題を最適なタイミングで再出題します。（プラン変更は現在iOSアプリから行えます）",
                )
              }
            >
              🔒 今日の復習（Premium）
            </button>
          )}
        </div>
      </div>

      <button
        className="btn primary solve-all"
        disabled={!target.length}
        onClick={() => setSession(target)}
      >
        演習をはじめる（{target.length}問）
      </button>
      {mode === "due" && !target.length ? (
        <p className="muted small">いま復習が必要な問題はありません。</p>
      ) : null}
    </div>
  );
}

// ---- 問題一覧タブ -------------------------------------------------------------------------------

function ListTab({
  questions,
  doc,
  pageCount,
  bookId,
  termsByPage,
  onChanged,
  onPractice,
}: {
  questions: QuestionRow[];
  doc: PDFDocumentProxy | null;
  pageCount: number;
  bookId: string | undefined;
  termsByPage: Map<number, string[]>;
  onChanged: () => void;
  onPractice: (rows: QuestionRow[]) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const byPage = useMemo(() => {
    const m = new Map<number, { tf: QuestionRow[]; mc4: QuestionRow[] }>();
    for (const q of questions) {
      const g = m.get(q.pageIndex) ?? { tf: [], mc4: [] };
      g[q.qtype].push(q);
      m.set(q.pageIndex, g);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [questions]);
  const tfTotal = useMemo(() => questions.filter((q) => q.qtype === "tf").length, [questions]);
  const mc4Total = questions.length - tfTotal;

  const toggleOpen = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const regenerate = async (page: number, qtype: Qtype) => {
    if (!bookId || !doc || busyKey) return;
    if (!ensureAiConsent()) return;
    if (!confirm(`P.${page + 1} の${qtypeShort(qtype)}問題を作り直します（今の問題は置き換わります。枠は消費しません）。よろしいですか？`)) return;
    const key = `${page}:${qtype}`;
    setBusyKey(key);
    setMsg(null);
    try {
      const pageTextOf = makePageTextGetter(doc, pageCount);
      const text = await pageTextOf(page);
      if (!text.trim()) throw new Error("本文を取得できませんでした");
      await generatePage({
        bookId,
        pageIndex: page,
        qtype,
        pageText: text,
        markedTerms: termsByPage.get(page) ?? [],
        density: "auto",
        regenerate: true,
        prevContext: (await pageTextOf(page - 1)).slice(-CONTEXT_CHARS),
        nextContext: (await pageTextOf(page + 1)).slice(0, CONTEXT_CHARS),
      });
      onChanged();
    } catch (e) {
      if (e instanceof QuotaError) setMsg(`今月の生成枠を使い切りました（${e.limit}回）。`);
      else if (e instanceof AiUnavailableError) setMsg("AI生成が未設定です。少し時間をおいてお試しください。");
      else setMsg(`作り直せませんでした：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyKey(null);
    }
  };

  const remove = async (page: number, qtype: Qtype) => {
    if (!bookId || busyKey) return;
    if (!confirm(`P.${page + 1} の${qtypeShort(qtype)}問題を削除します。よろしいですか？`)) return;
    await deleteQuestionGroup(bookId, page, qtype);
    void deleteCloudQuestions(bookId, page, qtype);
  };

  if (!questions.length) return <p className="muted">まだ問題がありません（「問題を作る」から生成できます）。</p>;

  return (
    <div className="qlist">
      <p className="muted small">
        ○× {tfTotal}問 ・ 4択 {mc4Total}問
      </p>
      {msg ? <p className="quiz-msg">{msg}</p> : null}
      {byPage.map(([page, g]) => (
        <div className="qlist-page" key={page}>
          <div className="qlist-page-head">P.{page + 1}</div>
          {(["tf", "mc4"] as Qtype[]).map((t) => {
            const qs = g[t];
            if (!qs.length) return null;
            const key = `${page}:${t}`;
            return (
              <div className="qlist-group" key={key}>
                <button className="qlist-group-head" onClick={() => toggleOpen(key)}>
                  <span>
                    {qtypeShort(t)} {qs.length}問
                  </span>
                  <span className="muted small">{open.has(key) ? "▲ 閉じる" : "▼ 内容を見る"}</span>
                </button>
                {open.has(key) ? (
                  <div className="qlist-body">
                    <ol className="qlist-items">
                      {qs.map((q) => (
                        <li key={q.id}>
                          <p className="qlist-stmt">{q.statement}</p>
                          {q.choices ? (
                            <ol className="qlist-choices">
                              {q.choices.map((c, i) => (
                                <li key={i} className={c === q.answer ? "is-answer" : ""}>
                                  {c}
                                </li>
                              ))}
                            </ol>
                          ) : (
                            <p className="qlist-ans">答え：{q.answer}</p>
                          )}
                          {q.choices ? <p className="qlist-ans">正解：{q.answer}</p> : null}
                          {q.explanation ? <p className="muted small">{q.explanation}</p> : null}
                        </li>
                      ))}
                    </ol>
                    <div className="qlist-actions">
                      <button className="btn sm primary" onClick={() => onPractice(qs)}>
                        このグループを演習
                      </button>
                      <button className="btn sm" disabled={busyKey !== null} onClick={() => void regenerate(page, t)}>
                        {busyKey === key ? "生成中…" : "再生成"}
                      </button>
                      <button className="btn sm danger-outline" disabled={busyKey !== null} onClick={() => void remove(page, t)}>
                        削除
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ---- 生成タブ ----------------------------------------------------------------------------------

type PageRunState = "wait" | "run" | "done" | "fail";

interface GenRun {
  total: number;
  done: number;
  current: number | null; // pageIndex being generated
  created: number; // questions created so far
  finished: boolean;
  cancelled: boolean;
}

function GenerateTab({
  bookId,
  doc,
  pageCount,
  termsByPage,
  questions,
  usage,
  defaultHint,
  onGenerated,
  onPractice,
}: {
  bookId: string | undefined;
  doc: PDFDocumentProxy | null;
  pageCount: number;
  termsByPage: Map<number, string[]>;
  questions: QuestionRow[];
  usage: GenUsage | null;
  defaultHint: string;
  onGenerated: () => void;
  onPractice: (rows: QuestionRow[]) => void;
}) {
  const [qtype, setQtype] = useState<Qtype>(() =>
    localStorage.getItem(QTYPE_PREF_KEY) === "mc4" ? "mc4" : "tf",
  );
  const [density, setDensity] = useState<Density>("auto");
  const [hint, setHint] = useState(defaultHint);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [filter, setFilter] = useState<PageFilter>("all");
  const [run, setRun] = useState<GenRun | null>(null);
  const [pageStates, setPageStates] = useState<Map<number, PageRunState>>(new Map());
  const [failures, setFailures] = useState<number[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const cancelRef = useRef(false);
  const createdRef = useRef<QuestionRow[]>([]);

  const pickQtype = (t: Qtype) => {
    setQtype(t);
    localStorage.setItem(QTYPE_PREF_KEY, t);
  };

  // Per-type generated counts (the 済 pills are per type; filter/summary follow the SELECTED type).
  const counts = useMemo(() => {
    const tf = new Map<number, number>();
    const mc4 = new Map<number, number>();
    for (const q of questions) {
      const m = q.qtype === "mc4" ? mc4 : tf;
      m.set(q.pageIndex, (m.get(q.pageIndex) ?? 0) + 1);
    }
    return { tf, mc4 };
  }, [questions]);
  const selCounts = counts[qtype];

  const pages = useMemo(() => [...termsByPage.keys()].sort((a, b) => a - b), [termsByPage]);
  const genCountTf = useMemo(() => pages.filter((p) => (counts.tf.get(p) ?? 0) > 0).length, [pages, counts]);
  const genCountMc4 = useMemo(() => pages.filter((p) => (counts.mc4.get(p) ?? 0) > 0).length, [pages, counts]);
  const displayPages = useMemo(() => {
    if (filter === "all") return pages;
    return pages.filter((p) => ((selCounts.get(p) ?? 0) > 0) === (filter === "done"));
  }, [pages, selCounts, filter]);

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
    const lo = Math.min(a, b) - 1;
    const hi = Math.max(a, b) - 1;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of pages) if (p >= lo && p <= hi) next.add(p);
      return next;
    });
  };

  // Only pages with no questions of the SELECTED type cost quota; generated ones are skipped.
  const toGenerate = useMemo(
    () => [...selected].filter((p) => !(selCounts.get(p) ?? 0)).sort((a, b) => a - b),
    [selected, selCounts],
  );

  const runBatch = async (targets: number[]) => {
    if (!bookId || !doc || !targets.length || run) return;
    if (!ensureAiConsent()) return;
    setMsg(null);
    cancelRef.current = false;
    createdRef.current = [];
    setFailures([]);
    setPageStates(new Map(targets.map((p) => [p, "wait"])));
    setRun({ total: targets.length, done: 0, current: null, created: 0, finished: false, cancelled: false });
    const pageTextOf = makePageTextGetter(doc, pageCount);
    const fails: number[] = [];
    let done = 0;
    for (const p of targets) {
      if (cancelRef.current) break;
      setRun((r) => r && { ...r, current: p, done });
      setPageStates((m) => new Map(m).set(p, "run"));
      const terms = termsByPage.get(p) ?? [];
      let ok = false;
      try {
        const text = await pageTextOf(p);
        if (terms.length && text.trim()) {
          const res = await generatePage({
            bookId,
            pageIndex: p,
            qtype,
            pageText: text,
            markedTerms: terms,
            density,
            subjectHint: hint,
            regenerate: false,
            prevContext: (await pageTextOf(p - 1)).slice(-CONTEXT_CHARS),
            nextContext: (await pageTextOf(p + 1)).slice(0, CONTEXT_CHARS),
          });
          createdRef.current.push(...res.questions);
          ok = true;
          done++;
          onGenerated();
        }
      } catch (e) {
        if (e instanceof QuotaError) {
          setMsg(`今月の生成枠を使い切りました（${e.limit}回）。来月またご利用いただくか、上位プランをご検討ください。`);
          setPageStates((m) => new Map(m).set(p, "fail"));
          fails.push(p);
          break;
        }
        if (e instanceof AiUnavailableError) {
          setMsg("AI生成が未設定です。少し時間をおいてお試しください。");
          setPageStates((m) => new Map(m).set(p, "fail"));
          fails.push(p);
          break;
        }
      }
      if (!ok) fails.push(p);
      setPageStates((m) => new Map(m).set(p, ok ? "done" : "fail"));
      setRun((r) => r && { ...r, done: ok ? done : r.done, created: createdRef.current.length });
    }
    setFailures(fails);
    setSelected(new Set());
    setRun((r) =>
      r && { ...r, current: null, done, created: createdRef.current.length, finished: true, cancelled: cancelRef.current },
    );
    onGenerated();
  };

  const closeRun = () => {
    setRun(null);
    setPageStates(new Map());
  };

  if (!bookId)
    return <p className="muted">この本はまだアカウントに登録されていません（取り込み直すと有効になります）。</p>;

  const remaining = usage && !usage.unlimited ? usage.remaining : Infinity;
  const willHitQuota = toGenerate.length > remaining;

  return (
    <div className="quiz-generate">
      <div className="gen-controls">
        <div className="gen-row">
          <span className="gen-label">問題の種類</span>
          <div className="preset-row">
            {QTYPE_LABELS.map((t) => (
              <button
                key={t.key}
                className={`btn sm ${qtype === t.key ? "primary" : ""}`}
                onClick={() => pickQtype(t.key)}
                disabled={!!run && !run.finished}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
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

      <div className="gen-row">
        <span className="gen-label">表示</span>
        <div className="preset-row">
          {PAGE_FILTERS.map((f) => (
            <button
              key={f.key}
              className={`btn sm ${filter === f.key ? "primary" : ""}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <p className="muted small">
        ○×: 済 {genCountTf} / {pages.length} ・ 4択: 済 {genCountMc4} / {pages.length} ページ。
        暗記箇所のあるページをチェックして「まとめて生成」（同じページでも ○× と 4択 は別カウント。
        生成済みの再表示は枠を消費しません）。
      </p>
      <p className="muted small">
        ⚠ 生成された問題はAIによるもので、誤りを含む場合があります。内容は必ずご自身で確認してください。
      </p>

      <div className="page-picker">
        {displayPages.map((p) => (
          <PageCard
            key={p}
            doc={doc}
            pageIndex={p}
            terms={termsByPage.get(p)?.length ?? 0}
            tfCount={counts.tf.get(p) ?? 0}
            mc4Count={counts.mc4.get(p) ?? 0}
            qtype={qtype}
            state={pageStates.get(p)}
            selected={selected.has(p)}
            onToggle={() => toggle(p)}
          />
        ))}
      </div>

      <div className="gen-footer">
        {run ? (
          <div className="gen-run">
            {!run.finished ? (
              <>
                <div className="gen-bar">
                  <div className="gen-bar-fill" style={{ width: `${(run.done / Math.max(1, run.total)) * 100}%` }} />
                </div>
                <div className="gen-run-row">
                  <span>
                    生成中 {run.done}/{run.total} ページ
                    {run.current !== null ? `（P.${run.current + 1} を生成中…）` : ""}
                  </span>
                  <button className="btn sm" onClick={() => (cancelRef.current = true)} disabled={cancelRef.current}>
                    {cancelRef.current ? "停止中…" : "キャンセル"}
                  </button>
                </div>
                <p className="muted small">キャンセルは実行中のページが終わってから停止します（以後のページは枠を消費しません）。</p>
              </>
            ) : (
              <div className="gen-run-done">
                <p>
                  {run.cancelled ? "キャンセルしました。" : ""}
                  {run.done}ページ・{run.created}問を作成しました。
                  {failures.length ? `（${failures.length}ページは失敗）` : ""}
                </p>
                <div className="gen-run-actions">
                  {createdRef.current.length ? (
                    <button className="btn primary" onClick={() => onPractice(createdRef.current)}>
                      演習をはじめる
                    </button>
                  ) : null}
                  {failures.length ? (
                    <button
                      className="btn sm"
                      onClick={() => {
                        const f = failures;
                        closeRun();
                        void runBatch(f);
                      }}
                    >
                      失敗した {failures.length} ページを再試行
                    </button>
                  ) : null}
                  <button className="btn ghost sm" onClick={closeRun}>
                    閉じる
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <button className="btn primary" disabled={!toGenerate.length || !doc} onClick={() => void runBatch(toGenerate)}>
            選んだ {toGenerate.length} ページの{qtypeShort(qtype)}問題をまとめて生成
          </button>
        )}
        {willHitQuota && !run ? (
          <span className="quiz-warn small">残り枠 {remaining} 回を超える分は生成されません。</span>
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
  tfCount,
  mc4Count,
  qtype,
  state,
  selected,
  onToggle,
}: {
  doc: PDFDocumentProxy | null;
  pageIndex: number;
  terms: number;
  tfCount: number;
  mc4Count: number;
  qtype: Qtype;
  state?: PageRunState;
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

  const selTypeCount = qtype === "mc4" ? mc4Count : tfCount;
  return (
    <button
      ref={ref}
      className={`page-card${selected ? " sel" : ""}${selTypeCount > 0 ? " gen" : ""}`}
      onClick={onToggle}
      disabled={state === "run"}
    >
      <div className="page-thumb">
        {url ? <img src={url} alt={`${pageIndex + 1}ページ`} loading="lazy" /> : <span className="muted small">…</span>}
        <span className="page-pills">
          {tfCount > 0 ? <span className="page-gen">○済</span> : null}
          {mc4Count > 0 ? <span className="page-gen mc4">④済</span> : null}
        </span>
        {selected && !state ? <span className="page-check">✓</span> : null}
        {state === "wait" ? <span className="page-state wait" /> : null}
        {state === "run" ? (
          <span className="page-state run">
            <span className="page-spinner" />
          </span>
        ) : null}
        {state === "done" ? <span className="page-state done">✓</span> : null}
        {state === "fail" ? <span className="page-state fail">⚠</span> : null}
      </div>
      <div className="page-card-meta">
        <span>P.{pageIndex + 1}</span>
        <span className={selTypeCount > 0 ? "gen-count" : "muted small"}>
          {selTypeCount > 0 ? `✓${selTypeCount}問` : `暗記${terms}`}
        </span>
      </div>
    </button>
  );
}
