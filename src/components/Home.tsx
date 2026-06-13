// Landing Home — concise hero + a few highlights + CTA. The detailed product explanation lives
// on the Service page; the nav/footer are rendered by App around all marketing pages.
import { useApp } from "../store/session";
import { Demo } from "./Demo";

const HIGHLIGHTS = [
  { emoji: "🎯", title: "自動で答えを検出", body: "色を見分けて答えの部分だけを隠します。手作業の塗りつぶしは不要。" },
  { emoji: "📕", title: "隠して覚える", body: "答えを隠した状態で通読、タップで確認。隠し方は赤マスクと赤シートから選べます。" },
  { emoji: "🤖", title: "解いて確かめる（AI ○×・4択）", body: "ページの本文と答えからAIが○×・4択問題を自動生成。覚えたつもりを解いて確認できます。" },
  { emoji: "☁️", title: "どこでも同期（Pro）", body: "本も学習の進捗も、全ての端末・プラットフォームでクラウド同期。" },
];

export function Home() {
  const setView = useApp((s) => s.setView);
  const start = () => setView({ name: "decks" });

  return (
    <div className="home">
      <section className="hero">
        <h1 className="hero-title">
          色付き答えのPDFが、そのまま
          <br />
          暗記ノートに。
        </h1>
        <p className="hero-lead">
          <strong>隠して覚え、解いて確かめる。</strong>
          色付きの答えが入ったPDFを取り込むだけ。答えを自動で検出して赤シートで隠し、
          AIが作る○×問題で理解を確認できます。インストール不要、検出は端末内だけ。
        </p>
        <div className="hero-cta">
          <div className="hero-buttons">
            <button className="btn primary big-cta" onClick={start}>
              無料で始める
            </button>
            <button className="btn ghost big-cta" onClick={() => setView({ name: "pricing" })}>
              料金プランを見る
            </button>
          </div>
          <p className="hero-note">ブラウザで今すぐ・無料アカウントで開始</p>
        </div>
      </section>

      <section className="demo-section">
        <h2 className="demo-heading">タップして、赤シートを体験</h2>
        <Demo />
        <p className="demo-note">
          実際はPDFを取り込むと、色付きの答えが自動でこの状態になります。
        </p>
      </section>

      <section className="features">
        {HIGHLIGHTS.map((f) => (
          <div className="feature-card" key={f.title}>
            <div className="feature-emoji" aria-hidden>
              {f.emoji}
            </div>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </div>
        ))}
      </section>

      <p className="center home-more">
        <button className="link-btn" onClick={() => setView({ name: "service" })}>
          サービスの詳細を見る →
        </button>
      </p>

      <section className="home-final-cta">
        <h2>さっそく試してみましょう</h2>
        <button className="btn primary big-cta" onClick={start}>
          無料で始める
        </button>
      </section>
    </div>
  );
}
