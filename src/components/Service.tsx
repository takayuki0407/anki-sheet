// "サービス" page — the detailed product explanation (features, how-it-works, platforms),
// split out of the landing Home so the marketing site has distinct pages.
import { useApp } from "../store/session";

const FEATURES = [
  {
    emoji: "🎯",
    title: "答えを自動で検出",
    body: "赤・マゼンタなどの色を見分けて、答えの部分だけを自動でマスク。手作業の塗りつぶしは要りません。『自動検出（おまかせ）』で色も自動判定、後から微調整もできます。",
  },
  {
    emoji: "📕",
    title: "隠して覚える",
    body: "タップで答えを表示、もう一度タップで再び隠す。隠し方は『赤マスク』（答えを個別に隠す）と『赤シート』（半透明のシートをスライド）から選べます。",
  },
  {
    emoji: "🤖",
    title: "解いて確かめる（AI問題生成）",
    body: "ページの本文と赤シートで隠す語句から、AI が○×・4択問題を自動生成。読んで覚えたあと“解いて確かめる”ことで、うろ覚えを洗い出せます。プラン別に月間の生成回数があります。",
  },
  {
    emoji: "🔒",
    title: "プライバシー安全",
    body: "PDFの色検出はすべてお使いの端末内で完結。AI問題の生成を使うときだけ、選んだページの本文と語句をサーバー経由でAIに送信します（オプトイン）。クラウド同期（Pro）では端末間共有のためPDF等がアカウントに保存されます。",
  },
  {
    emoji: "☁️",
    title: "どこでも同期（Pro）",
    body: "Proなら本も学習の進捗（★・しおり・読書位置）も、全ての端末・プラットフォームでクラウド同期。続きをすぐ再開できます。",
  },
];

const STEPS = [
  {
    title: "PDFを取り込む",
    body: "色付きの答えが印刷されたPDFを、ドラッグ＆ドロップまたはファイル選択で追加します。",
  },
  {
    title: "答えの色を検出",
    body: "『自動検出（おまかせ）』で色を自動判定。赤／マゼンタ／橙／青のプリセットや、プレビューを見ながらの微調整も可能です。",
  },
  {
    title: "隠して覚える",
    body: "検出された答えが隠れた状態で通読。タップで確認しながら、繰り返し覚えられます。隠し方は赤マスクと赤シートから選べます。",
  },
  {
    title: "解いて確かめる（AI ○×）",
    body: "ページの「問題」からAIが○×問題を生成。覚えたつもりを実際に解いて、理解を確認できます。",
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
          <strong>隠して覚え、解いて確かめる。</strong>
          色付きの答えが入ったPDFを取り込むだけで、答えを自動で検出して赤シートで隠し、
          AIが作る○×問題で理解を確認できます。手作業のマスクは要りません。
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
        <h2 className="section-title">使い方はかんたん4ステップ</h2>
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
