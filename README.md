# Anki-sheet

赤シート対応のPDF教材（色付きの語句を赤シートで隠せるタイプ）をドラッグ投入すると、
色付きの答えを自動検出し、**デジタル赤シート**として通読できる Webアプリ です。PDFの解析は
この端末のブラウザ内で行われます（Proのクラウド同期を使う場合のみ、利用者ご自身の端末間共有の
ためにアカウントへ保存されます）。

- **本棚**: 取り込んだ書籍を**表紙サムネイル付きの本棚**に並べて表示。表紙をタップして開きます。
- **赤シート・ビューア（「めくる」）**: ページをそのまま描画し、答えを赤シートで一括ON/OFF、
  個別タップで表示／**再タップで再び赤く隠す**（CIDフォントのPDFでも動作）。
- **2つの読み方**: **縦読み（全ページを縦に並べてスクロール・既定）**と**横読み（ページめくり）**を切替。
  読み方も前回開いたときのものを記憶して復元します。
- **表示**: どちらの読み方でも**全体表示（縦長ページが丸ごと見える）／幅に合わせる**を切替可能。
  **拡大縮小（50%〜400%）**・**全画面モード**に対応。
- **ページ移動（Kindle風）**: 前後送り・ページ番号入力・スライダーに加え、**画像の左右タップ**でめくり。
  位置と**進捗％**を操作行に表示。**前回の続きのページ・読み方から開きます**（位置と縦/横の読み方を記憶）。
- **目次（しおり）**: 章の先頭などをしおりとして登録し、一覧から移動できます
  （PDFに埋め込み目次が無い教材でも、自分の目次を作れます）。
- **拡大縮小**: ＋ / − で拡大し、スクロールして細部を確認できます。
- **改行をまたぐ暗記箇所**: 行をまたいで続く答えも 1 つの暗記箇所として扱います。
- **色の自動チューニング**: デッキ設定で色相・しきい値をライブプレビューしながら調整。
  見出しの除外、別の色（赤/橙/青）プリセット、再検出。
- **オフライン保存 / PWA**: デッキ・PDF・暗記箇所はブラウザ内（IndexedDB / Dexie）。
  ホーム画面に追加すればオフライン・全画面で利用できます。
- **バックアップ**: 全データ（PDF含む）をJSONで書き出し / 読み込み。
- **キーボード / ダークモード**: ビューアは ← → でめくり・Space で赤シート切替・＋/− で拡大。
  OSのダークモード設定に追従します。

## セットアップ

```bash
npm install        # 依存をインストール（pdf.jsのcMapsもpublic/へ自動コピー）
npm run dev        # 開発サーバ（http://localhost:5173）
npm run build      # 本番ビルド -> dist/
npm run preview    # ビルドをローカル配信
npm test           # 単体テスト
npm run typecheck  # 型チェック
```

ブラウザで開いたら「＋ PDFを取り込む」から赤シート対応PDFを選ぶだけです。
PC・スマホ両方のブラウザで動作します。

## iPhone / Android にインストール（PWA）

PWAなので、HTTPSで配信すればホーム画面に追加してアプリのように使えます。非公開リポジトリ
でも無料でHTTPS配信できる **Cloudflare Pages** か **Netlify** に接続してください（設定同梱）。

**Cloudflare Pages**: dash.cloudflare.com → Workers & Pages → Create → Pages →
「Connect to Git」→ GitHubを認可 → `anki-sheet` を選択 → Build command `npm run build`,
Output directory `dist` → Deploy。`https://anki-sheet.pages.dev` で公開されます。

**Netlify**: app.netlify.com → Add new site → Import an existing project → GitHub →
`anki-sheet` を選択（`netlify.toml` を自動認識）→ Deploy。

公開後:
- **iPhone**: Safari でそのURLを開く → 共有 → **「ホーム画面に追加」** → アイコンから
  全画面・オフラインで起動。
- **Android**: Chrome → メニュー → **「アプリをインストール」**。
- データは端末内（IndexedDB）に保存。iOSは長期間未使用だと消すことがあるため、
  **「バックアップを書き出す」で定期保存**してください。

## Docker で配信

このアプリは**完全クライアントサイドの静的サイト**です。Dockerはビルド済みの`dist/`を
nginxで配信するだけで、**スマホ側の動作には一切影響しません**（同じ静的ファイルが届きます）。

```bash
docker compose up -d --build      # ビルドして起動
# → http://localhost:8080 （PC）
# → http://<このPCのLAN IP>:8080 （同じWi-Fiのスマホから）
docker compose down               # 停止
```

`docker build -t anki-sheet . && docker run -p 8080:80 anki-sheet` でも同じです。

> **モバイルでPWA（ホーム画面追加・オフライン）を使うにはHTTPSが必須**です。
> Service WorkerはHTTP(`http://LAN-IP`)では無効になります（アプリ自体は動きます）。
> HTTPSにするには、本コンテナをCaddy等のHTTPSリバースプロキシ背後に置く、Cloudflare Tunnel
> を使う、または静的ホスト（GitHub Pages / Netlify / Cloudflare Pages）へ`dist/`をデプロイ
> してください。開発中にLANのスマホで確認するだけなら `npm run dev:host`（HTTP）でも可。

## 仕組み（重要メモ）

- **cMaps必須**: 日本語などのCIDフォントをpdf.jsで描画・抽出するには、`pdfjs-dist/cmaps`
  と`standard_fonts`を静的配信し、`cMapUrl`/`cMapPacked`/`standardFontDataUrl`を渡す必要が
  あります。これが無いと**グリフが描画されず**、`getTextContent()`も**0件**になります。
  本リポジトリでは `scripts/copy-pdfjs-assets.mjs` が `postinstall`/`predev`/`prebuild` で
  `public/pdfjs/` へ自動コピーします（`public/pdfjs` はgit管理外）。
- **色の検出**: pdf.jsはテキストの色を直接返さないため、ページをcanvasに描画し、各テキスト
  ランの位置のピクセル色をHSLバンド（既定はマゼンタ）で判定します（`src/detect/`）。
  座標とピクセル色のみを使うので、文字コードが化けても問題ありません。

## 主要ディレクトリ

```
src/detect/   色検出（colorBand / pixelSampler / spanMerge / detectPage）— 純粋関数
src/pdf/      pdf.js連携（描画・テキスト位置・cMap設定・全ページ検出）
src/srs/      ts-fsrsラッパ（scheduler）＋ 日次キュー（queue）
src/db/       Dexie スキーマ＋データアクセス
src/render/   PageOverlay（ページ描画＋赤シートマスクの唯一の実装）
src/components/  ImportWizard / DeckList / PageViewer / Settings
scripts/      cMapコピー、E2Eスモーク
```

## テスト

- **単体テスト** (`npm test`): 色バンド判定・読み順グルーピング・見出し除外・IoU など。
- **実PDF統合テスト** (任意): 実際のPDFに対して描画＋検出を実行（Node + @napi-rs/canvas）。
  ```bash
  # Windows (PowerShell)
  $env:ANKI_SHEET_TEST_PDF="C:\path\to\redsheet.pdf"; npm test
  ```
  例の財務諸表論PDF（252ページ）では約3,300個の暗記箇所を検出します
  （行をまたぐ答えは1つにまとめます）。
- **ブラウザE2Eスモーク** (任意, Edgeを使用):
  ```bash
  npm run preview &     # 別ターミナルで
  ANKI_SHEET_TEST_PDF="...pdf" node scripts/e2e-smoke.mjs
  ```

## 機能

- 取り込み: PDFをドロップ → 色付きの答えを自動検出（非ブロッキング・中止可・進捗表示）
- ビューア「めくる」: 赤シート一括ON/OFF・個別タップ・**ページ移動（送り/番号/スライダー）**・
  **目次（しおり）**・**拡大縮小**・キーボード操作
- 検出: 読み順グルーピングで**改行をまたぐ答えも1つの暗記箇所**に。見出しは高さで除外
- 設定: 色チューニング（ライブプレビュー・プリセット）＋ 再検出、デッキ名変更
- 複数デッキ管理 / PWA（インストール・オフライン）/ 全データのバックアップ
- ダークモード（OS設定に追従）

既知の調整ポイント:
- **検出ロジックを更新したときは、既存デッキは「設定 → このPDFを再検出」（ワンタップ）で作り直してください。**
  検出の改善（改行をまたぐ答えの統合など）は新規取り込み／再検出時に反映されます。
- 章見出しのマゼンタも検出されることがあります。設定の「見出し除外（高さ倍率）」を下げるか、
  色相・しきい値を調整して再検出してください（ライブプレビューで確認できます）。
- 検出はメインスレッドで実行（252ページで数十秒。中止可）。pdf.jsのフォント描画が
  document を必要とするため、レンダリングのWeb Worker化は将来課題です。
