// Marketing pricing page (reachable from Home). Layout follows the Goodnotes pricing feel:
// headline → monthly/annual toggle → plan cards (Pro highlighted) → comparison table → final CTA,
// with generous whitespace. Web is free for now; the subscriptions are introduced here.
import { useState } from "react";
import { useApp } from "../store/session";

const PLANS = [
  {
    key: "standard",
    name: "Standard",
    monthly: 300,
    yearly: 2500,
    tagline: "まずはここから。基本の暗記機能をすべて。",
    features: [
      "本を10冊まで取り込み",
      "答えの自動検出・赤マスク／赤シート",
      "目次・縦読み／横読み・倍率調整",
      "7日間の無料トライアル",
    ],
    highlight: false,
  },
  {
    key: "pro",
    name: "Pro",
    monthly: 600,
    yearly: 5000,
    tagline: "全部入り。端末をまたいでどこでも。",
    features: [
      "本を無制限に取り込み",
      "クラウドストレージ 5GB",
      "全ての端末・プラットフォームで進捗同期",
      "7日間の無料トライアル",
    ],
    highlight: true,
  },
];

const COMPARE = [
  { label: "本の取り込み", standard: "10冊まで", pro: "無制限" },
  { label: "答えの自動検出・赤マスク／赤シート", standard: "○", pro: "○" },
  { label: "目次・縦横読み・倍率調整", standard: "○", pro: "○" },
  { label: "クラウドストレージ", standard: "—", pro: "5GB" },
  { label: "全端末・全プラットフォームで進捗同期", standard: "—", pro: "○" },
  { label: "無料トライアル", standard: "7日間", pro: "7日間" },
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
            年額<span className="save">約30%お得</span>
          </button>
        </div>
      </section>

      <section className="plan-cards">
        {PLANS.map((p) => (
          <div className={`plan-card ${p.highlight ? "highlight" : ""}`} key={p.key}>
            {p.highlight && <span className="plan-badge">おすすめ</span>}
            <h2 className="plan-card-name">{p.name}</h2>
            <p className="plan-card-tagline">{p.tagline}</p>
            <p className="plan-card-price">
              <span className="amount">{yen(annual ? p.yearly : p.monthly)}</span>
              <span className="period"> / {annual ? "年" : "月"}</span>
            </p>
            <p className="plan-card-sub muted small">
              {annual ? `月あたり約 ${yen(Math.round(p.yearly / 12))}` : `年額 ${yen(p.yearly)}`}
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
        現在ブラウザ版は無料でお使いいただけます。サブスクリプション（Standard / Pro）は順次提供予定です。
      </p>

      <section className="compare-section">
        <h2 className="section-title">プランの比較</h2>
        <div className="compare-wrap">
          <table className="compare-table">
            <thead>
              <tr>
                <th></th>
                <th>Standard</th>
                <th className="pro-col">Pro</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map((r) => (
                <tr key={r.label}>
                  <td className="compare-feature">{r.label}</td>
                  <td>{r.standard}</td>
                  <td className="pro-col">{r.pro}</td>
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
