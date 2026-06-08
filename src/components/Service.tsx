// "サービス" page — the detailed product explanation (features, how-it-works, platforms),
// split out of the landing Home so the marketing site has distinct pages.
import { useApp } from "../store/session";

const FEATURES = [
  {
    emoji: "🎯",
    title: "答えを自動で検出",
    body: "赤・マゼンタなどの色を見分けて、答えの部分だけを自動でマスク。手作業の塗りつぶしは要りません。",
  },
  {
    emoji: "📕",
    title: "隠して暗記",
    body: "タップで答えを表示、もう一度タップで再び隠す。隠し方は『赤マスク』（答えを個別に隠す）と『赤シート』（半透明のシートをスライド）から選べます。",
  },
  {
    emoji: "🔒",
    title: "プライバシー安全",
    body: "PDFの解析はすべてお使いの端末内で完結。クラウド同期（Pro）を使うときだけ、ご自身の端末間で共有するためにPDFがアカウントに保存されます。",
  },
  {
    emoji: "☁️",
    title: "どこでも同期（Pro）",
    body: "Proなら本も学習の進捗も、全ての端末・プラットフォームでクラウド同期。続きをすぐ再開できます。",
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
    title: "隠して暗記",
    body: "検出された答えが隠れた状態で通読。タップで確認しながら、繰り返し覚えられます。隠し方は赤マスクと赤シートから選べます。",
  },
];

export function Service() {
  const setView = useApp((s) => s.setView);
  const start = () => setView({ name: "decks" });

  return (
    <div className="service home">
      <section className="page-hero">
        <h1 className="page-title">サービスについて</h1>
        <p className="page-lead">
          色付きの答えが入ったPDFを取り込むだけで、答えを自動で検出して隠せます。
          手作業のマスクは要りません。
        </p>
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
          Proなら全ての端末・プラットフォームで進捗が同期されます。
        </p>
      </section>

      <section className="home-final-cta">
        <h2>さっそく試してみましょう</h2>
        <button className="btn primary big-cta" onClick={start}>
          無料で始める
        </button>
      </section>
    </div>
  );
}
