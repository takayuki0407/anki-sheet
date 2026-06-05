import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { firstAnswerPage, getDeck, getDeckPdf, redetectDeck, updateDeck } from "../db/repo";
import { detectClozesInPdf, detectSinglePage, loadPdf } from "../pdf/pdfEngine";
import { PageOverlay } from "../render/PageOverlay";
import { useApp } from "../store/session";
import {
  COLOR_PRESETS,
  DEFAULT_MAGENTA_BAND,
  type DeckColorConfig,
  type PdfRow,
  type Rect,
} from "../types";

type Status = "loading" | "ready" | "error";
type Redetect =
  | { k: "idle" }
  | { k: "running"; page: number; total: number; found: number }
  | { k: "done"; kept: number; added: number; removed: number };

export function Settings({ deckId }: { deckId: number }) {
  const setView = useApp((s) => s.setView);
  const [status, setStatus] = useState<Status>("loading");
  const [errMsg, setErrMsg] = useState("");
  const [pdf, setPdf] = useState<PdfRow>();
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const [docReady, setDocReady] = useState(false);

  const [name, setName] = useState("");
  const [color, setColor] = useState<DeckColorConfig>(DEFAULT_MAGENTA_BAND);
  const [newLimit, setNewLimit] = useState(20);
  const [revLimit, setRevLimit] = useState(200);
  const [retention, setRetention] = useState(0.9);

  const [previewPage, setPreviewPage] = useState(0);
  const [highlights, setHighlights] = useState<Rect[]>([]);
  const [redetect, setRedetect] = useState<Redetect>({ k: "idle" });

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setDocReady(false);
    (async () => {
      try {
        const d = await getDeck(deckId);
        if (!d) throw new Error("デッキが見つかりません");
        const p = await getDeckPdf(deckId);
        if (!p) throw new Error("PDFが見つかりません");
        const doc = await loadPdf(p.blob);
        if (cancelled) {
          await doc.loadingTask.destroy();
          return;
        }
        docRef.current = doc;
        setPdf(p);
        setName(d.name);
        setColor({ ...DEFAULT_MAGENTA_BAND, ...d.color });
        setNewLimit(d.dailyNewLimit);
        setRevLimit(d.dailyReviewLimit);
        setRetention(d.requestRetention);
        setPreviewPage(await firstAnswerPage(deckId));
        setDocReady(true);
        setStatus("ready");
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

  // Live preview: re-detect just the current page on color/page change (debounced).
  useEffect(() => {
    const doc = docRef.current;
    if (!docReady || !doc) return;
    let active = true;
    const id = setTimeout(async () => {
      try {
        const cz = await detectSinglePage(doc, previewPage, color);
        if (active) setHighlights(cz.flatMap((c) => c.rects));
      } catch {
        /* ignore transient preview errors */
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [color, previewPage, docReady]);

  const set = <K extends keyof DeckColorConfig>(k: K, v: DeckColorConfig[K]) =>
    setColor((c) => ({ ...c, [k]: v }));

  const saveSettings = async () => {
    await updateDeck(deckId, {
      name: name.trim() || "無題のデッキ",
      color,
      dailyNewLimit: newLimit,
      dailyReviewLimit: revLimit,
      requestRetention: retention,
    });
    setView({ name: "decks" });
  };

  const runRedetect = async () => {
    if (!pdf) return;
    if (
      !confirm(
        "現在の色設定でこのPDFを再検出します。位置が一致するカードの学習進捗は保持され、" +
          "新しい語句は追加、検出されなくなった語句は削除されます。実行しますか？",
      )
    )
      return;
    setRedetect({ k: "running", page: 0, total: pdf.pageCount, found: 0 });
    try {
      const result = await detectClozesInPdf(pdf.blob, color, (page, total, found) =>
        setRedetect({ k: "running", page, total, found }),
      );
      const r = await redetectDeck(deckId, color, result.clozes);
      await updateDeck(deckId, {
        name: name.trim() || "無題のデッキ",
        dailyNewLimit: newLimit,
        dailyReviewLimit: revLimit,
        requestRetention: retention,
      });
      setRedetect({ k: "done", ...r });
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      setRedetect({ k: "idle" });
    }
  };

  if (status === "loading") return <div className="centered">読み込み中…</div>;
  if (status === "error")
    return (
      <div className="centered">
        <p>エラー: {errMsg}</p>
        <button className="btn" onClick={() => setView({ name: "decks" })}>
          戻る
        </button>
      </div>
    );

  const doc = docRef.current;
  const pageCount = pdf?.pageCount ?? 1;

  return (
    <div className="panel settings">
      <div className="panel-head">
        <button className="btn ghost" onClick={() => setView({ name: "decks" })}>
          ← 戻る
        </button>
        <h2>デッキ設定</h2>
        <button className="btn primary" onClick={saveSettings}>
          保存
        </button>
      </div>

      <label className="field">
        デッキ名
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <h3 className="section">色の検出（プレビュー）</h3>
      <div className="preset-row">
        {COLOR_PRESETS.map((p) => (
          <button
            key={p.key}
            className="btn sm"
            onClick={() => setColor((c) => ({ ...c, hueTarget: p.hueTarget, hueTol: p.hueTol }))}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="tuner-preview">
        <div className="viewer-nav">
          <button
            className="btn sm"
            disabled={previewPage <= 0}
            onClick={() => setPreviewPage((p) => Math.max(0, p - 1))}
          >
            ← 前
          </button>
          <span className="muted">
            p.{previewPage + 1}/{pageCount} ・ 緑 {highlights.length} 個
          </span>
          <button
            className="btn sm"
            disabled={previewPage >= pageCount - 1}
            onClick={() => setPreviewPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            次 →
          </button>
        </div>
        {doc && docReady && pdf && (
          <PageOverlay
            doc={doc}
            pageIndex={previewPage}
            pageW={pdf.pageW}
            highlightRects={highlights}
            maxWidth={520}
          />
        )}
      </div>

      <Slider label="色相 (hue)" value={color.hueTarget} min={0} max={360} step={1}
        onChange={(v) => set("hueTarget", v)} />
      <Slider label="色相の許容幅" value={color.hueTol} min={0} max={90} step={1}
        onChange={(v) => set("hueTol", v)} />
      <Slider label="最小彩度" value={color.satMin} min={0} max={1} step={0.05}
        onChange={(v) => set("satMin", v)} />
      <Slider label="明度 下限" value={color.lightMin} min={0} max={1} step={0.05}
        onChange={(v) => set("lightMin", v)} />
      <Slider label="明度 上限" value={color.lightMax} min={0} max={1} step={0.05}
        onChange={(v) => set("lightMax", v)} />
      <Slider label="検出感度 (最小ピクセル)" value={color.minBandPx} min={2} max={40} step={1}
        onChange={(v) => set("minBandPx", v)} />
      <Slider label="見出し除外 (高さ倍率)" value={color.maxHeightRatio} min={1} max={4} step={0.1}
        onChange={(v) => set("maxHeightRatio", v)} />

      <h3 className="section">学習設定</h3>
      <Slider label="1日の新規カード上限" value={newLimit} min={0} max={200} step={5}
        onChange={setNewLimit} />
      <Slider label="1日の復習上限" value={revLimit} min={10} max={1000} step={10}
        onChange={setRevLimit} />
      <Slider label="目標保持率" value={retention} min={0.7} max={0.97} step={0.01}
        onChange={setRetention} />

      <h3 className="section">再検出</h3>
      <p className="muted small">
        色や感度を変えたら再検出してカードを作り直せます（一致するカードの進捗は保持）。
      </p>
      {redetect.k === "running" && (
        <div className="progress-box">
          <p>再検出中… {redetect.page}/{redetect.total}（{redetect.found}個）</p>
          <div className="bar">
            <div className="bar-fill" style={{ width: `${(redetect.page / redetect.total) * 100}%` }} />
          </div>
        </div>
      )}
      {redetect.k === "done" && (
        <p className="ok-note">
          完了: 保持 {redetect.kept} ・ 追加 {redetect.added} ・ 削除 {redetect.removed}
        </p>
      )}
      <button
        className="btn"
        disabled={redetect.k === "running"}
        onClick={runRedetect}
      >
        このPDFを再検出
      </button>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="slider-row">
      <span className="slider-label">
        {label}
        <span className="slider-val">{Number.isInteger(step) ? value : value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  );
}
