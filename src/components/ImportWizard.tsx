import { useCallback, useRef, useState } from "react";
import { CancelledError, detectClozesInPdf, type PdfDetectionResult } from "../pdf/pdfEngine";
import { importBookmarks, importDeck } from "../db/repo";
import { useApp } from "../store/session";
import {
  COLOR_PRESETS,
  DEFAULT_MAGENTA_BAND,
  type ColorPreset,
  type DeckColorConfig,
} from "../types";

type Phase =
  | { k: "idle" }
  | { k: "detecting"; page: number; total: number; found: number }
  | { k: "ready"; result: PdfDetectionResult; blob: Blob }
  | { k: "saving" }
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

export function ImportWizard() {
  const setView = useApp((s) => s.setView);
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [name, setName] = useState("");
  const [copied, setCopied] = useState(false);
  // Answer color to detect (chosen before / at import, like the iOS version). Kept in a ref so
  // the async detect closure always reads the latest choice.
  const [color, setColor] = useState<DeckColorConfig>(DEFAULT_MAGENTA_BAND);
  const colorRef = useRef(color);
  colorRef.current = color;
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const detect = useCallback(async (blob: Blob) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({ k: "detecting", page: 0, total: 0, found: 0 });
    try {
      const result = await detectClozesInPdf(
        blob,
        colorRef.current,
        (page, total, found) => setPhase({ k: "detecting", page, total, found }),
        controller.signal,
      );
      setPhase({ k: "ready", result, blob });
    } catch (e) {
      if (e instanceof CancelledError) setPhase({ k: "idle" });
      else setPhase({ k: "error", ...describeError(e) });
    } finally {
      abortRef.current = null;
    }
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      if (file.size > MAX_PDF_BYTES) {
        setPhase({
          k: "error",
          message: `PDFが大きすぎます（${Math.round(file.size / 1024 / 1024)}MB）。1ファイル ${MAX_PDF_MB}MB までです。`,
          detail: `file: ${file.name}\nsize: ${file.size} bytes`,
        });
        return;
      }
      setName(file.name.replace(/\.pdf$/i, ""));
      await detect(file.slice(0, file.size, "application/pdf"));
    },
    [detect],
  );

  const pickPreset = (p: ColorPreset) =>
    setColor((c) => ({ ...c, hueTarget: p.hueTarget, hueTol: p.hueTol }));
  const presetActive = (p: ColorPreset) =>
    color.hueTarget === p.hueTarget && color.hueTol === p.hueTol;

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f && f.type === "application/pdf") void handleFile(f);
  };

  const save = async () => {
    if (phase.k !== "ready") return;
    const { result, blob } = phase;
    setPhase({ k: "saving" });
    try {
      const deckId = await importDeck({
        name: name.trim() || "無題のデッキ",
        blob,
        pageCount: result.pageCount,
        pageW: result.pageW,
        pageH: result.pageH,
        color: colorRef.current,
        clozes: result.clozes,
      });
      // Import the PDF's built-in outline (目次) as bookmarks, if it has one.
      if (result.outline.length) await importBookmarks(deckId, result.outline);
      // Cover is generated lazily in the bookshelf, so import doesn't load the PDF
      // a second time (keeps peak memory lower — important on iOS).
      setView({ name: "decks" });
    } catch (e) {
      setPhase({ k: "error", ...describeError(e) });
    }
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <button className="btn ghost" onClick={() => setView({ name: "decks" })}>
          ← 戻る
        </button>
        <h2>PDFを取り込む</h2>
      </div>

      {phase.k === "idle" && (
        <>
          <div className="import-color">
            <span className="import-color-label">答えの色（隠したい文字の色）</span>
            <div className="preset-row">
              {COLOR_PRESETS.map((p) => (
                <button
                  key={p.key}
                  className={`btn sm ${presetActive(p) ? "primary" : ""}`}
                  onClick={() => pickPreset(p)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div
            className="dropzone"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
          >
            <p className="dz-big">赤シート対応のPDFをドロップ</p>
            <p className="dz-sub">またはクリックして選択</p>
            <p className="dz-note">
              選んだ色の語句を自動で検出し、暗記カードにします。
              PDFはこの端末内だけで処理され、アップロードされません。
            </p>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf"
              hidden
              onChange={onPick}
            />
          </div>
        </>
      )}

      {phase.k === "detecting" && (
        <div className="progress-box">
          <p>解析中… ページ {phase.page}/{phase.total || "?"}</p>
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
          <div className="import-color">
            <span className="import-color-label">検出が合わない時は色を変えて再検出</span>
            <div className="preset-row">
              {COLOR_PRESETS.map((p) => (
                <button
                  key={p.key}
                  className={`btn sm ${presetActive(p) ? "primary" : ""}`}
                  onClick={() => pickPreset(p)}
                >
                  {p.label}
                </button>
              ))}
              <button className="btn sm" onClick={() => void detect(phase.blob)}>
                この色で再検出
              </button>
            </div>
          </div>
          <label className="field">
            デッキ名
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="row">
            <button className="btn ghost" onClick={() => setPhase({ k: "idle" })}>
              やり直す
            </button>
            <button className="btn primary" onClick={save}>
              このデッキを作成
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
      <p className="build-tag">build {__BUILD_ID__}</p>
    </div>
  );
}
