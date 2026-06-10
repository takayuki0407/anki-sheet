// 情報・ヘルプ画面 — usage help, account/data notes, support + legal links, about.
// Reachable from the topbar "情報" link.
import { useEffect, useState } from "react";
import { useApp } from "../store/session";
import { deleteAccount, signOutUser, useAuth } from "../auth/useAuth";
import { listBooks, type AccountBooks } from "../sync/api";
import { getDeviceName, setDeviceName } from "../sync/device";
import { applyDeviceNameToLocalBooks } from "../sync/deck";
import { clearAllLocalData } from "../db/backup";
import { DevTierSwitch } from "./DevTierSwitch";

const SUPPORT_EMAIL = "zabieru.0407@gmail.com";

const FAQ = [
  {
    q: "Kiokumate（キオクメイト）とは？",
    a: "色付きの答え（赤・マゼンタなど）が印刷されたPDFを取り込むと、答えの部分を自動で検出して隠せます。タップで答えを確認しながら暗記でき、隠し方は『赤マスク』（答えを個別に隠す）と『赤シート』（半透明のシートをスライド）から選べます。PDFの解析は端末内で完結します（解析のために送信されることはありません）。クラウド同期（Pro）を使う場合のみ、ご自身の端末間で共有するためにPDFがアカウントに保存されます。",
  },
  {
    q: "PDFの取り込み方",
    a: "本棚の「＋ PDFを取り込む」からファイルを選びます。答えの色は『自動検出（おまかせ）』で自動判定できるほか、赤／マゼンタ／橙／青のプリセット選択や微調整も可能です。検出には少し時間がかかります（中止可）。スキャン画像のPDF（テキスト層が無いもの）は現在未対応です。",
  },
  {
    q: "検出がうまくいかない時",
    a: "本の「設定（⚙）」から『自動検出』をやり直すか、答えの色プリセットや詳細（色相・許容幅・彩度の下限・見出し除外など）を調整して『このPDFを再検出』してください。1ページのプレビューで結果を見ながら追い込めます。再検出しても、付けていた ★ は同じ答えに残ります。",
  },
  {
    q: "AIで○×問題を作る（解いて確かめる）",
    a: "本の「問題」から、ページの本文と赤シートで隠す語句をもとにAIが正誤問題（○×）を自動生成します。覚えたつもりを“解いて確かめる”ための機能です。この機能だけは、選んだページの本文と語句を当アプリのサーバー経由で外部のAIサービスに送信します（初回に同意確認）。送信した内容は既定でAIモデルの学習には使われません。生成される問題は誤りを含む場合があるため、内容はご自身で確認してください。色の検出・赤シートなど他の機能は端末内だけで完結します。生成した問題はご自身のアカウント内に保存され、ほかのユーザーへ共有されません。プラン別に月間の生成回数の上限があります（1回＝1ページ×問題の種類。残り枠は『情報・ヘルプ → プラン』で確認）。",
  },
  {
    q: "プランについて",
    a: "サインインだけで使える Free（本1冊・AI生成 月1回）／Standard ¥300（本10冊・AI 月10回）／Pro ¥600（本 無制限・AI 月30回・全端末でクラウド同期）／Premium ¥980（Proの全機能・AI 月200回・「今日の復習」で間違えやすい問題を最適なタイミングに再出題。初回7日間無料）。AI生成は「1回＝1ページ×問題の種類」で数えます。本の冊数はアカウント全体（すべての端末の合計）で数えます。未契約でもロックされず Free として使えます。料金は「料金プラン」ページ、現在のプラン・AI残り枠は「情報・ヘルプ → プラン」で確認できます。",
  },
  {
    q: "本のクラウド保存と復元（Pro）",
    a: "Pro で取り込んだ本は PDF・検出結果・学習の進捗（★・しおり・読書位置）がクラウドに保存され、別の端末からも取り込み直せます。Standard/Free に下げると上限を超えた本はクラウドに退避し（約6ヶ月保持）、再び Pro にすると復元できます。本棚の各本の「☁️ クラウドあり／端末のみ」表示で、削除しても後で戻せるかが分かります（「端末のみ」は削除すると復元できません）。",
  },
  {
    q: "ビューアの操作",
    a: "答えをタップで表示／もう一度タップで再び隠す。隠し方は『赤マスク』（答えを個別に隠す）と『赤シート』（縦読みで半透明シートをスライド）から選べます。倍率は ± と数値入力、「100%」ボタンで等倍に戻せます。『縦読み／横読み』『目次（しおり）』『★（覚えにくい答えだけ復習）』にも対応。しおりは目次の ✎ で名前を編集できます。",
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

function planLabel(tier?: string): string {
  switch (tier) {
    case "admin":
      return "管理者（無制限）";
    case "premium":
      return "Premium";
    case "pro":
      return "Pro";
    case "standard":
      return "Standard";
    case "free":
      return "Free";
    default:
      return "—";
  }
}

// The AI generation monthly allowance per tier (mirrors the server's genPageLimit).
// One generation = one page × one question type (○× / 4択).
function aiQuotaLabel(tier?: string): string {
  switch (tier) {
    case "admin":
      return "無制限";
    case "premium":
      return "月200回";
    case "pro":
      return "月30回";
    case "standard":
      return "月10回";
    default:
      return "月1回"; // free / signed-in default
  }
}

export function Info() {
  const setView = useApp((s) => s.setView);
  const user = useAuth((s) => s.user);
  const [usage, setUsage] = useState<AccountBooks | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [delPw, setDelPw] = useState("");
  const [delBusy, setDelBusy] = useState(false);
  const [delMsg, setDelMsg] = useState("");
  const [deviceName, setDeviceNameInput] = useState(getDeviceName());
  const [devSaving, setDevSaving] = useState(false);
  const [devSaved, setDevSaved] = useState(false);

  const onSaveDeviceName = async () => {
    setDevSaving(true);
    setDeviceName(deviceName); // persist locally (used for future registrations / cloud sync)
    try {
      await applyDeviceNameToLocalBooks(); // re-stamp this device's cloud books with the new name
      setDevSaved(true);
      setTimeout(() => setDevSaved(false), 2000);
    } catch {
      /* best-effort — the name is saved locally regardless */
    } finally {
      setDevSaving(false);
    }
  };

  const onSignOut = async () => {
    if (
      !window.confirm(
        "ログアウトしてもこの端末の本は保持されますが、サインインするまで開けなくなります。",
      )
    )
      return;
    await signOutUser(); // keep local data; the sign-in gate locks it until re-login
    setView({ name: "decks" });
  };

  const onDeleteAccount = async () => {
    if (
      !window.confirm(
        "本当にアカウントを削除しますか？\nクラウドのPDF・検出結果・進捗、そしてこの端末内のデータもすべて削除され、元に戻せません。",
      )
    )
      return;
    setDelBusy(true);
    setDelMsg("");
    try {
      await deleteAccount(delPw);
      await clearAllLocalData();
      alert("アカウントとデータをすべて削除しました。");
      setView({ name: "home" });
    } catch (e) {
      const code = e && typeof e === "object" && "code" in e ? String((e as { code: string }).code) : "";
      setDelMsg(
        /wrong-password|invalid-credential|invalid-login/.test(code)
          ? "パスワードが正しくありません。"
          : "削除に失敗しました：" + (e instanceof Error ? e.message : String(e)),
      );
    } finally {
      setDelBusy(false);
    }
  };
  useEffect(() => {
    if (!user) {
      setUsage(null);
      return;
    }
    let live = true;
    void listBooks()
      .then((u) => live && setUsage(u))
      .catch(() => live && setUsage(null));
    return () => {
      live = false;
    };
  }, [user]);
  return (
    <div className="panel info-page">
      <div className="panel-head">
        <button className="btn ghost" onClick={() => setView({ name: "decks" })}>
          ← 本棚
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
          {user ? (
            <>
              <p>
                ログイン中：<strong>{user.email ?? "（メール未設定）"}</strong>
              </p>
              {usage ? (
                <p className="usage-line">
                  {usage.unlimited ? (
                    <>
                      取り込み：<strong>{usage.count} 冊</strong>（{planLabel(usage.tier)}・無制限）
                    </>
                  ) : (
                    <>
                      取り込み（アカウント全体）：
                      <strong>
                        {usage.count} / {usage.limit} 冊
                      </strong>
                      （あと {Math.max(0, usage.limit - usage.count)} 冊）
                    </>
                  )}
                </p>
              ) : null}
              <p className="muted small">
                同じアカウントで iOSアプリ にもログインできます。Proでは端末・プラットフォーム間で
                クラウド同期されます。
              </p>
              <div className="device-name-field">
                <label htmlFor="device-name">この端末の名前</label>
                <div className="device-name-row">
                  <input
                    id="device-name"
                    className="device-name-input"
                    value={deviceName}
                    onChange={(e) => setDeviceNameInput(e.target.value)}
                    placeholder="例：DESKTOP-8OFFRJ5"
                  />
                  <button className="btn sm" disabled={devSaving} onClick={() => void onSaveDeviceName()}>
                    {devSaved ? "✓ 保存しました" : devSaving ? "保存中…" : "保存"}
                  </button>
                </div>
                <p className="muted small">
                  クラウドの本一覧に表示される、この端末の名前です。ブラウザは実際のPC名を取得できないため
                  自由に設定できます（空欄にすると自動名に戻ります）。
                </p>
              </div>
              <button className="btn ghost sm" onClick={() => void onSignOut()}>
                ログアウト
              </button>
              <div className="danger-zone">
                {!delOpen ? (
                  <button
                    className="linklike danger-link"
                    onClick={() => {
                      setDelOpen(true);
                      setDelMsg("");
                      setDelPw("");
                    }}
                  >
                    アカウントを削除
                  </button>
                ) : (
                  <div className="delete-account">
                    <p className="small">
                      アカウントを削除すると、
                      <strong>クラウドに保存されたPDF・検出結果・進捗もすべて削除</strong>され、元に
                      戻せません。確認のためパスワードを入力してください（この端末内のデータは残ります）。
                    </p>
                    <input
                      type="password"
                      className="del-pw"
                      placeholder="パスワード"
                      value={delPw}
                      autoComplete="current-password"
                      onChange={(e) => setDelPw(e.target.value)}
                    />
                    {delMsg && <p className="auth-msg">{delMsg}</p>}
                    <div className="del-actions">
                      <button
                        className="btn ghost sm"
                        disabled={delBusy}
                        onClick={() => {
                          setDelOpen(false);
                          setDelPw("");
                          setDelMsg("");
                        }}
                      >
                        キャンセル
                      </button>
                      <button
                        className="btn danger sm"
                        disabled={delBusy || !delPw}
                        onClick={onDeleteAccount}
                      >
                        {delBusy ? "削除中…" : "削除する"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <p>
                <strong>アカウント</strong>を作成すると、iOSアプリと同じアカウントで利用でき、
                Proでは端末・プラットフォーム間でクラウド同期できます。
              </p>
              <p className="muted small">
                ログインしない場合も、データ（取り込んだPDF・検出結果・しおり）は
                <strong>このブラウザ内だけ</strong>に保存され、引き続き無料で使えます。
              </p>
              <button className="btn primary sm" onClick={() => setView({ name: "login" })}>
                ログイン / アカウント作成
              </button>
            </>
          )}
        </div>
      </section>

      <section className="info-section">
        <h3 className="section">プラン</h3>
        <div className="info-card">
          {!user ? (
            <p className="muted small">
              プランの確認・変更には{" "}
              <button className="linklike" onClick={() => setView({ name: "login" })}>
                ログイン
              </button>
              してください。
            </p>
          ) : (
            <>
              <p>
                現在のプラン：<strong>{planLabel(usage?.tier)}</strong>
              </p>
              <p className="muted small">
                AI問題の生成：<strong>{aiQuotaLabel(usage?.tier)}</strong>
                {usage && !usage.unlimited ? `／本は ${usage.limit} 冊まで` : "／本は無制限"}
              </p>
              <div className="plan-compare">
                <div className={`plan-col ${usage?.tier === "standard" ? "current" : ""}`}>
                  <h4>Standard</h4>
                  <p className="plan-price">
                    ¥300<span className="muted small"> /月</span>
                    <br />
                    <span className="muted small">¥2,500 /年</span>
                  </p>
                  <ul>
                    <li>本を10冊まで取り込み</li>
                    <li>AI問題生成：月10回</li>
                  </ul>
                </div>
                <div className={`plan-col ${usage?.tier === "pro" ? "current" : ""}`}>
                  <h4>Pro</h4>
                  <p className="plan-price">
                    ¥600<span className="muted small"> /月</span>
                    <br />
                    <span className="muted small">¥5,000 /年</span>
                  </p>
                  <ul>
                    <li>本を無制限に取り込み</li>
                    <li>クラウド保存・全端末で同期</li>
                    <li>AI問題生成：月30回</li>
                  </ul>
                </div>
                <div className={`plan-col pro ${usage?.tier === "premium" ? "current" : ""}`}>
                  <h4>Premium</h4>
                  <p className="plan-price">
                    ¥980<span className="muted small"> /月</span>
                    <br />
                    <span className="muted small">¥8,000 /年</span>
                  </p>
                  <ul>
                    <li>Pro の全機能</li>
                    <li>AI問題生成：月200回</li>
                    <li>「今日の復習」（最適なタイミングで再出題）</li>
                  </ul>
                </div>
              </div>
              <p className="muted small">
                無料の <strong>Free</strong>（本1冊・AI生成 月1回）はサインインだけで使えます。AI生成は
                「1回＝1ページ×問題の種類」で数えます。<strong>Premium</strong> は初回7日間無料です。
              </p>
              {usage?.tier === "admin" ? (
                <p className="muted small">
                  管理者アカウントのため、すべての機能を無制限でご利用いただけます。
                </p>
              ) : usage?.tier === "pro" ? (
                <button
                  className="btn ghost sm"
                  onClick={() =>
                    alert(
                      "プランの変更・解約は現在 iOSアプリ から行えます（Web版の課金は準備中です）。",
                    )
                  }
                >
                  プランを変更
                </button>
              ) : (
                <button
                  className="btn primary sm"
                  onClick={() =>
                    alert(
                      "Proへのアップグレードは現在 iOSアプリ から行えます（Web版の課金は準備中です）。",
                    )
                  }
                >
                  Pro にアップグレード
                </button>
              )}
              <DevTierSwitch />
            </>
          )}
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
            <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Kiokumate お問い合わせ")}`}>
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
          <p className="small">Kiokumate（キオクメイト）</p>
          <p className="small">
            <button className="linklike" onClick={() => setView({ name: "home" })}>
              製品紹介・料金プランページ →
            </button>
          </p>
          <p className="muted small">build {__BUILD_ID__}</p>
          <p className="muted small">
            pdf.js — Apache-2.0 (© Mozilla) ／ React — MIT ／ Dexie・zustand・colord — MIT
          </p>
        </div>
      </section>
    </div>
  );
}
