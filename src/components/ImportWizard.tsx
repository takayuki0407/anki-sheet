import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  autoDetectColorConfig,
  CancelledError,
  detectClozesInPdf,
  loadPdf,
  type PdfDetectionResult,
} from "../pdf/pdfEngine";
import { PageOverlay } from "../render/PageOverlay";
import { importBookmarks, importDeck } from "../db/repo";
import { useApp } from "../store/session";
import { useAuth } from "../auth/useAuth";
import { registerBook } from "../sync/api";
import { uploadDeck } from "../sync/deck";
import { BookLimitDialog, type PendingImport } from "./BookLimitDialog";
import {
  COLOR_PRESETS,
  DEFAULT_MAGENTA_BAND,
  type ColorPreset,
  type DeckColorConfig,
  type DetectedCloze,
} from "../types";

type Phase =
  | { k: "idle" }
  | { k: "configuring"; blob: Blob } // choose the answer color(s) before detecting
  | { k: "probing" }
  | { k: "detecting"; color: number; colors: number; page: number; total: number; found: number }
  | { k: "ready"; result: PdfDetectionResult; blob: Blob }
  | { k: "saving" }
  | { k: "overlimit"; pending: PendingImport }
  | { k: "error"; message: string; detail: string };

// Capture everything useful about a failure (name, message, full stack, build id,
// environment) so it can be read/copied off a device that has no dev tools.
function describeError(e: unknown): { message: string; detail: string } {
  const err = e instanceof Error ? e : new Error(String(e));
  const detail = [
    `${err.name}: ${err.message}`,
    `build: ${__BUILD_ID__}`,
    `ua: ${navigator.userAgent}`,
    `dpr: ${window.devicePixelRatio} coarse: ${matchMedia("(pointer: coarse)").matches}`,
    "",
    err.stack || "(no stack)",
  ].join("\n");
  return { message: err.message, detail };
}

// Per-file size cap (matches iOS). Pro cloud sync is bounded to 5GB total; a 100MB/file ceiling
// keeps any single book reasonable for storage + in-browser memory during detection.
const MAX_PDF_MB = 100;
const MAX_PDF_BYTES = MAX_PDF_MB * 1024 * 1024;

const presetToConfig = (p: ColorPreset): DeckColorConfig => ({
  ...DEFAULT_MAGENTA_BAND,
  hueTarget: p.hueTarget,
  hueTol: p.hueTol,
});

// Merge clozes from several single-color passes, dropping ONLY true duplicates (an answer two
// colors both matched) — kept unless an already-kept cloze on the same page actually OVERLAPS it.
// Distinct answers never overlap, so none are lost. (Only used when 2+ colors are selected.)
function mergeClozes(lists: DetectedCloze[][]): DetectedCloze[] {
  const out: DetectedCloze[] = [];
  for (const list of lists) {
    for (const c of list) {
      const dup = out.some(
        (o) =>
          o.pageIndex === c.pageIndex &&
          c.bbox.x < o.bbox.x + o.bbox.w &&
          c.bbox.x + c.bbox.w > o.bbox.x &&
          c.bbox.y < o.bbox.y + o.bbox.h &&
          c.bbox.y + c.bbox.h > o.bbox.y,
      );
      if (!dup) out.push(c);
    }
  }
  return out;
}

export function ImportWizard() {
  const setView = useApp((s) => s.setView);
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [name, setName] = useState("");
  const [copied, setCopied] = useState(false);
  // Answer-color choice made BEFORE detecting (the user picks; we no longer silently auto-detect):
  // 自動 (probe + pick one) OR one-or-more manual presets (union of their detections).
  const [useAuto, setUseAuto] = useState(true);
  const [manualKeys, setManualKeys] = useState<Set<string>>(new Set(["red"]));
  const colorRef = useRef<DeckColorConfig>(DEFAULT_MAGENTA_BAND); // primary color saved on the deck
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Result-screen preview: load the PDF once we have a result so the user can flip through ANY page
  // and check the detection (no auto-jump). Non-essential — a load failure is silently ignored.
  const [previewPage, setPreviewPage] = useState(0);
  const [previewDoc, setPreviewDoc] = useState<PDFDocumentProxy | null>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const readyBlob = phase.k === "ready" ? phase.blob : null;
  useEffect(() => {
    if (!readyBlob) return;
    let cancelled = false;
    setPreviewPage(0);
    setPreviewDoc(null);
    (async () => {
      try {
        const doc = await loadPdf(readyBlob);
        if (cancelled) {
          void doc.loadingTask.destroy();
          return;
        }
        docRef.current = doc;
        setPreviewDoc(doc);
      } catch {
        /* preview is optional */
      }
    })();
    return () => {
      cancelled = true;
      const d = docRef.current;
      docRef.current = null;
      void d?.loadingTask.destroy();
    };
  }, [readyBlob]);

  const handleFile = useCallback((file: File) => {
    if (file.size > MAX_PDF_BYTES) {
      setPhase({
        k: "error",
        message: `PDFが大きすぎます（${Math.round(file.size / 1024 / 1024)}MB）。1ファイル ${MAX_PDF_MB}MB までです。`,
        detail: `file: ${file.name}\nsize: ${file.size} bytes`,
      });
      return;
    }
    setName(file.name.replace(/\.pdf$/i, ""));
    setPhase({ k: "configuring", blob: file.slice(0, file.size, "application/pdf") });
  }, []);

  // Run detection for the chosen color(s): 自動 probes one color; manual unions each selected color
  // (one pass per color — single-color PDFs run once). Cancel returns to the color chooser.
  const runDetect = useCallback(
    async (blob: Blob) => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        let configs: DeckColorConfig[];
        if (useAuto) {
          setPhase({ k: "probing" });
          configs = [await autoDetectColorConfig(blob, controller.signal)];
        } else {
          configs = [...manualKeys]
            .map((k) => COLOR_PRESETS.find((p) => p.key === k))
            .filter((p): p is ColorPreset => !!p)
            .map(presetToConfig);
          if (!configs.length) configs = [DEFAULT_MAGENTA_BAND];
        }
        colorRef.current = configs[0];
        const lists: DetectedCloze[][] = [];
        let base: PdfDetectionResult | null = null;
        for (let i = 0; i < configs.length; i++) {
          const r = await detectClozesInPdf(
            blob,
            configs[i],
            (page, total, found) =>
              setPhase({ k: "detecting", color: i + 1, colors: configs.length, page, total, found }),
            controller.signal,
          );
          lists.push(r.clozes);
          if (!base) base = r;
        }
        // Single color (incl. 自動): use the detection AS-IS (identical to before — no merge step).
        const clozes = configs.length > 1 ? mergeClozes(lists) : lists[0];
        setPhase({ k: "ready", result: { ...base!, clozes }, blob });
      } catch (e) {
        if (e instanceof CancelledError) setPhase({ k: "configuring", blob });
        else setPhase({ k: "error", ...describeError(e) });
      } finally {
        abortRef.current = null;
      }
    },
    [useAuto, manualKeys],
  );

  const toggleManual = (key: string) => {
    setUseAuto(false);
    setManualKeys((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      if (!n.size) n.add(key); // keep at least one manual color selected
      return n;
    });
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f && f.type === "application/pdf") handleFile(f);
  };

  // Create the local deck (after a slot has been reserved) and open it. Cover is generated lazily in
  // the bookshelf, so import doesn't load the PDF twice (lower peak memory).
  const finishImport = useCallback(
    async (p: PendingImport) => {
      setPhase({ k: "saving" });
      const deckId = await importDeck({
        name: p.deckName,
        bookId: p.bookId,
        blob: p.blob,
        pageCount: p.result.pageCount,
        pageW: p.result.pageW,
        pageH: p.result.pageH,
        color: colorRef.current,
        clozes: p.result.clozes,
      });
      if (p.result.outline.length) await importBookmarks(deckId, p.result.outline);
      // Pro cloud sync: upload the PDF + content in the background (best-effort; 403 on standard).
      if (useAuth.getState().user) void uploadDeck(p.bookId, deckId).catch(() => {});
      setView({ name: "viewer", deckId }); // 保存して開く
    },
    [setView],
  );

  const save = async () => {
    if (phase.k !== "ready") return;
    const { result, blob } = phase;
    const pending: PendingImport = {
      bookId: crypto.randomUUID(),
      deckName: name.trim() || "無題のデッキ",
      result,
      blob,
      limit: 10,
    };
    setPhase({ k: "saving" });
    try {
      // Reserve an account-global slot FIRST when signed in. limit_reached -> the over-limit
      // chooser (pick a book to delete, or upgrade). Offline / signed-out / network errors fail
      // OPEN (import locally) so the local-first experience never breaks.
      if (useAuth.getState().user) {
        try {
          const r = await registerBook(pending.bookId, pending.deckName, result.pageCount);
          if (!r.ok && r.limitReached) {
            setPhase({ k: "overlimit", pending: { ...pending, limit: r.limit ?? 10 } });
            return;
          }
        } catch {
          /* fail open — keep the book locally; the registry reconciles later */
        }
      }
      await finishImport(pending);
    } catch (e) {
      setPhase({ k: "error", ...describeError(e) });
    }
  };

  // Answer-color chooser: 自動 + the presets (manual is multi-select). Shared by the configure
  // screen and the result screen (change colors → re-detect).
  const colorChooser = (
    <div className="import-color">
      <span className="import-color-label">答えの色（複数選択できます）</span>
      <div className="preset-row">
        <button
          className={`btn sm ${useAuto ? "primary" : ""}`}
          onClick={() => setUseAuto(true)}
        >
          自動
        </button>
        {COLOR_PRESETS.map((p) => (
          <button
            key={p.key}
            className={`btn sm ${!useAuto && manualKeys.has(p.key) ? "primary" : ""}`}
            onClick={() => toggleManual(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="muted small">
        自動はシステムが答えの色を判定します。色を選ぶと、選んだ色（複数可）で検出します。
      </p>
    </div>
  );

  return (
    <div className="panel">
      <div className="panel-head">
        <button className="btn ghost" onClick={() => setView({ name: "decks" })}>
          ← 戻る
        </button>
        <h2>PDFを取り込む</h2>
      </div>

      {phase.k === "idle" && (
        <div
          className="dropzone"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          <p className="dz-big">赤シート対応のPDFをドロップ</p>
          <p className="dz-sub">またはクリックして選択</p>
          <p className="dz-note">
            次の画面で答えの色（自動／赤・マゼンタなど、複数可）を選んで検出します。
            解析はこの端末内で行われます（クラウド同期を使う場合のみ、Proでアカウントに保存）。
          </p>
          <input ref={inputRef} type="file" accept="application/pdf" hidden onChange={onPick} />
        </div>
      )}

      {phase.k === "configuring" && (
        <div className="ready-box">
          <p className="muted">「{name || "無題"}」を取り込みます。答えの色を選んでください。</p>
          {colorChooser}
          <div className="row">
            <button className="btn ghost" onClick={() => setPhase({ k: "idle" })}>
              別のPDFを選ぶ
            </button>
            <button className="btn primary" onClick={() => void runDetect(phase.blob)}>
              取り込む
            </button>
          </div>
        </div>
      )}

      {phase.k === "probing" && (
        <div className="progress-box">
          <p>答えの色を判定しています…</p>
          <p className="muted">最適な色を選んでから検出します</p>
          <button className="btn ghost" onClick={() => abortRef.current?.abort()}>
            中止
          </button>
        </div>
      )}

      {phase.k === "detecting" && (
        <div className="progress-box">
          <p>
            解析中… ページ {phase.page}/{phase.total || "?"}
            {phase.colors > 1 ? `（色 ${phase.color}/${phase.colors}）` : ""}
          </p>
          <div className="bar">
            <div
              className="bar-fill"
              style={{ width: phase.total ? `${(phase.page / phase.total) * 100}%` : "0%" }}
            />
          </div>
          <p className="muted">検出した語句: {phase.found}</p>
          <button className="btn ghost" onClick={() => abortRef.current?.abort()}>
            中止
          </button>
        </div>
      )}

      {phase.k === "ready" && (
        <div className="ready-box">
          <p className="big-count">
            <strong>{phase.result.clozes.length}</strong> 個の語句を検出しました
            （{phase.result.pageCount}ページ）
          </p>
          {phase.result.outline.length > 0 && (
            <p className="muted small">
              PDFの目次 {phase.result.outline.length} 件もしおりに取り込みます
            </p>
          )}
          {previewDoc &&
            (() => {
              const pageRects = phase.result.clozes
                .filter((c) => c.pageIndex === previewPage)
                .flatMap((c) => c.rects);
              return (
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
                      p.{previewPage + 1}/{phase.result.pageCount} ・ 検出 {pageRects.length} 個
                    </span>
                    <button
                      className="btn sm"
                      disabled={previewPage >= phase.result.pageCount - 1}
                      onClick={() =>
                        setPreviewPage((p) => Math.min(phase.result.pageCount - 1, p + 1))
                      }
                    >
                      次 →
                    </button>
                  </div>
                  <PageOverlay
                    doc={previewDoc}
                    pageIndex={previewPage}
                    pageW={phase.result.pageW}
                    highlightRects={pageRects}
                    maxWidth={520}
                  />
                </div>
              );
            })()}
          {colorChooser}
          <button className="btn sm" onClick={() => void runDetect(phase.blob)}>
            この色で再検出
          </button>
          <label className="field">
            デッキ名
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="row">
            <button className="btn ghost" onClick={() => setPhase({ k: "idle" })}>
              別のPDFを選ぶ
            </button>
            <button className="btn primary" onClick={save}>
              保存して開く
            </button>
          </div>
        </div>
      )}

      {phase.k === "saving" && <p>保存中…</p>}

      {phase.k === "error" && (
        <div className="error-box">
          <p>エラー: {phase.message}</p>
          <pre className="error-detail" aria-label="エラー詳細">
            {phase.detail}
          </pre>
          <div className="row">
            <button
              className="btn"
              onClick={() => {
                void navigator.clipboard?.writeText(phase.detail).then(
                  () => setCopied(true),
                  () => setCopied(false),
                );
              }}
            >
              {copied ? "コピーしました" : "詳細をコピー"}
            </button>
            <button className="btn" onClick={() => setPhase({ k: "idle" })}>
              戻る
            </button>
          </div>
        </div>
      )}
      {phase.k === "overlimit" && (
        <BookLimitDialog
          pending={phase.pending}
          onImport={finishImport}
          onCancel={() =>
            setPhase({ k: "ready", result: phase.pending.result, blob: phase.pending.blob })
          }
          onUpgrade={() =>
            alert("Proへのアップグレードは現在 iOSアプリ からご利用いただけます（Web版の課金は準備中です）。")
          }
        />
      )}
      <p className="build-tag">build {__BUILD_ID__}</p>
    </div>
  );
}
