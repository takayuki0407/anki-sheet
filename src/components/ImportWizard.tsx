import { useCallback, useRef, useState } from "react";
import { CancelledError, detectClozesInPdf, type PdfDetectionResult } from "../pdf/pdfEngine";
import { importDeck } from "../db/repo";
import { useApp } from "../store/session";
import { DEFAULT_MAGENTA_BAND } from "../types";

type Phase =
  | { k: "idle" }
  | { k: "detecting"; page: number; total: number; found: number }
  | { k: "ready"; result: PdfDetectionResult; blob: Blob }
  | { k: "saving" }
  | { k: "error"; message: string };

export function ImportWizard() {
  const setView = useApp((s) => s.setView);
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setName(file.name.replace(/\.pdf$/i, ""));
    const blob = file.slice(0, file.size, "application/pdf");
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({ k: "detecting", page: 0, total: 0, found: 0 });
    try {
      const result = await detectClozesInPdf(
        blob,
        DEFAULT_MAGENTA_BAND,
        (page, total, found) => setPhase({ k: "detecting", page, total, found }),
        controller.signal,
      );
      setPhase({ k: "ready", result, blob });
    } catch (e) {
      if (e instanceof CancelledError) setPhase({ k: "idle" });
      else setPhase({ k: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      abortRef.current = null;
    }
  }, []);

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
      await importDeck({
        name: name.trim() || "無題のデッキ",
        blob,
        pageCount: result.pageCount,
        pageW: result.pageW,
        pageH: result.pageH,
        color: DEFAULT_MAGENTA_BAND,
        clozes: result.clozes,
      });
      setView({ name: "decks" });
    } catch (e) {
      setPhase({ k: "error", message: e instanceof Error ? e.message : String(e) });
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
        <div
          className="dropzone"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          <p className="dz-big">赤シート対応のPDFをドロップ</p>
          <p className="dz-sub">またはクリックして選択</p>
          <p className="dz-note">
            色付き（マゼンタ／赤）の語句を自動で検出し、暗記カードにします。
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
          <button className="btn" onClick={() => setPhase({ k: "idle" })}>
            戻る
          </button>
        </div>
      )}
    </div>
  );
}
