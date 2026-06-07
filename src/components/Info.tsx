// 情報・ヘルプ画面 — usage help, account/data notes, support + legal links, about.
// Reachable from the topbar "情報" link.
import { useState } from "react";
import { useApp } from "../store/session";

const SUPPORT_EMAIL = "zabieru.0407@gmail.com";

const FAQ = [
  {
    q: "赤シート暗記とは？",
    a: "色付きの答え（赤・マゼンタなど）が印刷されたPDFを取り込むと、答えを自動で検出してマスクし、デジタル赤シートとして隠しながら暗記できます。PDFは端末内だけで処理され、どこにもアップロードされません。",
  },
  {
    q: "PDFの取り込み方",
    a: "本棚の「＋ PDFを取り込む」からファイルを選び、答えの色（赤／マゼンタ／橙／青）を選んで検出します。検出には少し時間がかかります（中止可）。",
  },
  {
    q: "検出がうまくいかない時",
    a: "本の「設定」から、答えの色プリセットや詳細（色相・許容幅・彩度の下限・見出し除外など）を調整して『このPDFを再検出』してください。1ページのプレビューで結果を見ながら追い込めます。",
  },
  {
    q: "ビューアの操作",
    a: "答えをタップで表示／もう一度タップで再び隠す。『赤シート』ボタンで一括ON/OFF。倍率は ± と数値入力、「100%」ボタンで等倍に戻せます。『縦読み／横読み』『目次（しおり）』にも対応。しおりは目次の ✎ で名前を編集できます。",
  },
];

function Faq({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="faq">
      <button className="faq-q" onClick={() => setOpen((v) => !v)}>
        <span>{q}</span>
        <span aria-hidden>{open ? "−" : "＋"}</span>
      </button>
      {open && <p className="faq-a">{a}</p>}
    </div>
  );
}

export function Info() {
  const setView = useApp((s) => s.setView);
  return (
    <div className="panel info-page">
      <div className="panel-head">
        <button className="btn ghost" onClick={() => setView({ name: "home" })}>
          ← ホーム
        </button>
        <h2>情報・ヘルプ</h2>
      </div>

      <section className="info-section">
        <h3 className="section">使い方</h3>
        {FAQ.map((f) => (
          <Faq key={f.q} q={f.q} a={f.a} />
        ))}
      </section>

      <section className="info-section">
        <h3 className="section">アカウント</h3>
        <div className="info-card">
          <p>
            現在ウェブ版は<strong>アカウント不要</strong>で利用でき、データ（取り込んだPDF・検出結果・
            しおり）は<strong>このブラウザ内だけ</strong>に保存されます。
          </p>
          <p className="muted small">
            iOSアプリとのアカウント連携・サブスクリプションの同期は準備中です。端末・ブラウザ間でデータを
            移すには、本棚の「バックアップを書き出す／読み込む」をご利用ください。
          </p>
        </div>
      </section>

      <section className="info-section">
        <h3 className="section">データ・バックアップ</h3>
        <div className="info-card">
          <p className="muted small">
            本棚画面の「バックアップを書き出す」で全データをJSONとして保存、「読み込む」で復元できます
            （iOS版とも互換）。ブラウザのデータ消去で消えるため、定期的な書き出しをおすすめします。
          </p>
          <button className="btn sm" onClick={() => setView({ name: "decks" })}>
            本棚を開く
          </button>
        </div>
      </section>

      <section className="info-section">
        <h3 className="section">サポート・規約</h3>
        <ul className="info-links">
          <li>
            <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Anki-sheet お問い合わせ")}`}>
              お問い合わせ
            </a>
          </li>
          <li>
            <a href="/privacy.html" target="_blank" rel="noopener noreferrer">
              プライバシーポリシー
            </a>
          </li>
          <li>
            <a href="/terms.html" target="_blank" rel="noopener noreferrer">
              利用規約
            </a>
          </li>
        </ul>
      </section>

      <section className="info-section">
        <h3 className="section">このアプリについて</h3>
        <div className="info-card">
          <p className="small">Anki-sheet（赤シート暗記）</p>
          <p className="muted small">build {__BUILD_ID__}</p>
          <p className="muted small">
            pdf.js — Apache-2.0 (© Mozilla) ／ React — MIT ／ Dexie・zustand・colord — MIT
          </p>
        </div>
      </section>
    </div>
  );
}
