// Shared footer for the marketing pages.
import { useApp } from "../store/session";

export function SiteFooter() {
  const setView = useApp((s) => s.setView);
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <strong>Kiokumate</strong>
          <span className="muted small">隠して覚え、解いて確かめる。</span>
        </div>
        <div className="site-footer-links">
          <button className="link-btn" onClick={() => setView({ name: "home" })}>
            ホーム
          </button>
          <button className="link-btn" onClick={() => setView({ name: "service" })}>
            サービス
          </button>
          <button className="link-btn" onClick={() => setView({ name: "pricing" })}>
            料金プラン
          </button>
          <button className="link-btn" onClick={() => setView({ name: "info" })}>
            情報・ヘルプ
          </button>
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer">
            プライバシー
          </a>
          <a href="/terms.html" target="_blank" rel="noopener noreferrer">
            利用規約
          </a>
        </div>
      </div>
      <p className="site-footer-copy muted small">© 2026 Kiokumate</p>
    </footer>
  );
}
