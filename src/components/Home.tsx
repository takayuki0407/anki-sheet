// Landing Home — concise hero + a few highlights + CTA. The detailed product explanation lives
// on the Service page; the nav/footer are rendered by App around all marketing pages.
import { useApp } from "../store/session";

const HIGHLIGHTS = [
  { emoji: "🎯", title: "自動で答えを検出", body: "色を見分けて答えの部分だけをマスク。手作業の塗りつぶしは不要。" },
  { emoji: "📕", title: "赤シートで暗記", body: "タップで答えを表示、もう一度タップで再び隠す。一括ON/OFFも。" },
  { emoji: "☁️", title: "どこでも同期（Pro）", body: "本も学習の進捗も、全ての端末・プラットフォームでクラウド同期。" },
];

export function Home() {
  const setView = useApp((s) => s.setView);
  const start = () => setView({ name: "decks" });

  return (
    <div className="home">
      <section className="hero">
        <h1 className="hero-title">
          赤シートで、PDFがそのまま
          <br />
          暗記ノートに。
        </h1>
        <p className="hero-lead">
          色付きの答えが入ったPDFを取り込むだけ。答えを自動で検出して、デジタル赤シートで隠せます。
          インストール不要、解析は端末内だけ。
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
          <p className="hero-note">ブラウザで今すぐ・登録不要</p>
        </div>
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
