// Marketing pricing page (reachable from Home). Layout follows the Goodnotes pricing feel:
// headline → monthly/annual toggle → plan cards (Pro highlighted) → comparison table → final CTA,
// with generous whitespace. Web is free for now; the subscriptions are introduced here.
import { useState } from "react";
import { useApp } from "../store/session";

const PLANS = [
  {
    key: "free",
    name: "Free",
    monthly: 0,
    yearly: 0,
    tagline: "まずは無料で。1冊でじっくりお試し。",
    features: [
      "本を1冊まで取り込み",
      "答えの自動検出・赤マスク／赤シート",
      "目次・縦読み／横読み・倍率調整",
      "AI ○×問題の自動生成：月1ページ",
    ],
    highlight: false,
    coming: false,
  },
  {
    key: "standard",
    name: "Standard",
    monthly: 300,
    yearly: 3000,
    tagline: "基本の暗記機能をすべて。たっぷり10冊。",
    features: [
      "本を10冊まで取り込み",
      "答えの自動検出・赤マスク／赤シート",
      "目次・縦読み／横読み・倍率調整",
      "AI ○×問題の自動生成：月10ページ",
      "7日間の無料トライアル",
    ],
    highlight: false,
    coming: false,
  },
  {
    key: "pro",
    name: "Pro",
    monthly: 600,
    yearly: 6000,
    tagline: "全部入り。端末をまたいでどこでも。",
    features: [
      "本を無制限に取り込み",
      "クラウド保存・全端末／全OSで進捗同期",
      "AI ○×問題の自動生成：月30ページ",
      "7日間の無料トライアル",
    ],
    highlight: true,
    coming: false,
  },
  {
    key: "premium",
    name: "Premium",
    monthly: 980,
    yearly: 9800,
    tagline: "Pro のすべて＋AIが復習を最適化。",
    features: [
      "Pro のすべて",
      "適応SRSで最適なタイミングに出題（近日）",
      "AI ○×問題の自動生成：月200ページ",
    ],
    highlight: false,
    coming: true,
  },
];

const COMPARE = [
  { label: "本の取り込み", free: "1冊", standard: "10冊", pro: "無制限", premium: "無制限" },
  { label: "答えの自動検出・赤マスク／赤シート", free: "○", standard: "○", pro: "○", premium: "○" },
  { label: "目次・縦横読み・倍率調整", free: "○", standard: "○", pro: "○", premium: "○" },
  {
    label: "AI ○×問題の生成（月あたり）",
    free: "1ページ",
    standard: "10ページ",
    pro: "30ページ",
    premium: "200ページ",
  },
  { label: "クラウド保存・全端末で同期", free: "—", standard: "—", pro: "○", premium: "○" },
  { label: "適応SRS復習", free: "—", standard: "—", pro: "—", premium: "近日" },
  { label: "無料トライアル", free: "—", standard: "7日間", pro: "7日間", premium: "7日間" },
];

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

export function Pricing() {
  const setView = useApp((s) => s.setView);
  const [annual, setAnnual] = useState(true);
  const start = () => setView({ name: "decks" });

  return (
    <div className="pricing">
      <section className="pricing-hero">
        <h1 className="pricing-title">学習に合わせて選べる料金プラン</h1>
        <p className="pricing-lead">7日間は無料でお試し。いつでも解約できます。</p>
        <div className="pricing-toggle" role="group" aria-label="請求サイクル">
          <button className={annual ? "" : "on"} onClick={() => setAnnual(false)}>
            月額
          </button>
          <button className={annual ? "on" : ""} onClick={() => setAnnual(true)}>
            年額<span className="save">2ヶ月分お得</span>
          </button>
        </div>
      </section>

      <section className="plan-cards">
        {PLANS.map((p) => (
          <div className={`plan-card ${p.highlight ? "highlight" : ""}`} key={p.key}>
            {p.coming ? (
              <span className="plan-badge">近日</span>
            ) : (
              p.highlight && <span className="plan-badge">おすすめ</span>
            )}
            <h2 className="plan-card-name">{p.name}</h2>
            <p className="plan-card-tagline">{p.tagline}</p>
            <p className="plan-card-price">
              {p.monthly === 0 ? (
                <span className="amount">¥0</span>
              ) : (
                <>
                  <span className="amount">{yen(annual ? p.yearly : p.monthly)}</span>
                  <span className="period"> / {annual ? "年" : "月"}</span>
                </>
              )}
            </p>
            <p className="plan-card-sub muted small">
              {p.monthly === 0
                ? "ずっと無料"
                : annual
                  ? `月あたり約 ${yen(Math.round(p.yearly / 12))}`
                  : `年額 ${yen(p.yearly)}`}
            </p>
            <ul className="plan-card-features">
              {p.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <button
              className={`btn ${p.highlight ? "primary" : "ghost"} big-cta`}
              onClick={start}
            >
              無料で始める
            </button>
          </div>
        ))}
      </section>

      <p className="pricing-note center muted small">
        現在ブラウザ版は無料でお使いいただけます。サブスクリプション（Standard / Pro / Premium）は順次提供予定です。Premium の適応SRSは近日提供。
      </p>

      <section className="compare-section">
        <h2 className="section-title">プランの比較</h2>
        <div className="compare-wrap">
          <table className="compare-table">
            <thead>
              <tr>
                <th></th>
                <th>Free</th>
                <th>Standard</th>
                <th className="pro-col">Pro</th>
                <th>Premium</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map((r) => (
                <tr key={r.label}>
                  <td className="compare-feature">{r.label}</td>
                  <td>{r.free}</td>
                  <td>{r.standard}</td>
                  <td className="pro-col">{r.pro}</td>
                  <td>{r.premium}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="pricing-final">
        <h2>まずは無料で試してみましょう</h2>
        <button className="btn primary big-cta" onClick={start}>
          無料で始める
        </button>
        <p className="muted small center">
          7日間の無料トライアル付き。トライアル終了時に解約しない限り、選択したプランの料金が自動で
          請求されます。解約はいつでも可能です。
        </p>
      </section>
    </div>
  );
}
