// Marketing landing page — introduces the whole service (not just the reader). It is the
// default view; the bookshelf/app is one click away via the CTAs and the topbar brand.
import { useApp } from "../store/session";

const FEATURES = [
  {
    emoji: "🎯",
    title: "答えを自動で検出",
    body: "赤・マゼンタなどの色を見分けて、答えの部分だけを自動でマスク。手作業の塗りつぶしは要りません。",
  },
  {
    emoji: "📕",
    title: "赤シートで暗記",
    body: "タップで答えを表示、もう一度タップで再び隠す。『赤シート』ボタンで一括ON/OFFも。",
  },
  {
    emoji: "🔒",
    title: "プライバシー安全",
    body: "PDFの解析はすべてお使いの端末内で完結。ファイルがサーバーに送られることはありません。",
  },
  {
    emoji: "📑",
    title: "読みやすい工夫",
    body: "目次（しおり）、縦読み／横読み、拡大縮小、前回の続きから再開。",
  },
];

const STEPS = [
  {
    title: "PDFを取り込む",
    body: "色付きの答えが印刷されたPDFを、ドラッグ＆ドロップまたはファイル選択で追加します。",
  },
  {
    title: "答えの色を選んで検出",
    body: "赤／マゼンタ／橙／青のプリセットから選ぶだけ。プレビューを見ながら微調整もできます。",
  },
  {
    title: "赤シートで隠して暗記",
    body: "検出された答えが隠れた状態で通読。タップで確認しながら、繰り返し覚えられます。",
  },
];

export function Home() {
  const setView = useApp((s) => s.setView);
  const start = () => setView({ name: "decks" });

  return (
    <div className="home">
      <section className="hero">
        <h1 className="hero-title">
          赤シートで、PDFがそのまま<br />暗記ノートに。
        </h1>
        <p className="hero-lead">
          色付きの答えが入ったPDFを取り込むだけ。答えを自動で検出して、デジタル赤シートで隠せます。
          インストール不要、解析は端末内だけ。
        </p>
        <div className="hero-cta">
          <button className="btn primary big-cta" onClick={start}>
            無料で始める
          </button>
          <p className="hero-note">ブラウザで今すぐ・登録不要</p>
        </div>
      </section>

      <section className="features">
        {FEATURES.map((f) => (
          <div className="feature-card" key={f.title}>
            <div className="feature-emoji" aria-hidden>
              {f.emoji}
            </div>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </div>
        ))}
      </section>

      <section className="steps-section">
        <h2 className="section-title">使い方は3ステップ</h2>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li className="step" key={s.title}>
              <span className="step-no">{i + 1}</span>
              <div>
                <h4>{s.title}</h4>
                <p>{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="platforms">
        <h2 className="section-title">どこでも暗記</h2>
        <p className="muted center platforms-note">
          ブラウザ版は今すぐ無料で使えます。iOSアプリは近日公開予定です。
        </p>
      </section>

      <section className="home-final-cta">
        <h2>さっそく試してみましょう</h2>
        <button className="btn primary big-cta" onClick={start}>
          無料で始める
        </button>
      </section>

      <footer className="home-footer">
        <span>© 2026 Anki-sheet</span>
        <span className="muted">赤シート暗記 — 色付き答えのPDFを、そのまま暗記ツールに</span>
        <span className="home-footer-links">
          <button className="link-btn" onClick={() => setView({ name: "info" })}>
            情報・ヘルプ
          </button>
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer">
            プライバシー
          </a>
          <a href="/terms.html" target="_blank" rel="noopener noreferrer">
            利用規約
          </a>
        </span>
      </footer>
    </div>
  );
}
