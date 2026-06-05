# Anki-sheet — 赤シート暗記アプリ

赤シート対応のPDF教材（色付きの語句を赤シートで隠せるタイプ）をドラッグ投入すると、
色付きの答えを自動検出して、Anki方式の間隔反復（SRS）で暗記できる **完全クライアント
サイドのWebアプリ** です。PDFはこの端末のブラウザ内だけで処理され、どこにもアップロード
されません。

- **ビジュアル・クローズカード**: ページをそのまま描画し、答えの部分だけ「赤シート」で覆い、
  タップで解答を表示します（文字コードに依存しないので、CIDフォントのPDFでも動作）。
- **赤シート・ビューア（「めくる」）**: ページをめくりながら、そのページの答えを赤シートで
  一括ON/OFF、個別タップで部分表示。物理の赤シートそのままの使い心地です。
- **SRS**: [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)（FSRS）で
  もう一度/難しい/ふつう/簡単 を採点し、次回の出題日を自動計算。
- **色の自動チューニング**: デッキ設定で色相・しきい値をライブプレビューしながら調整。
  見出しの除外、別の色（赤/橙/青）プリセット、再検出（一致カードの学習進捗は保持）。
- **オフライン保存 / PWA**: デッキ・PDF・カード・履歴はブラウザ内（IndexedDB / Dexie）。
  ホーム画面に追加すればオフライン・全画面で利用できます。
- **バックアップ**: 全データ（PDF含む）をJSONで書き出し / 読み込み。
- **キーボード / ダークモード**: 学習は 1〜4 で採点・Space で解答、ビューアは ← → でめくり。
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
src/components/  ImportWizard / DeckList / Reviewer
scripts/      cMapコピー、E2Eスモーク
```

## テスト

- **単体テスト** (`npm test`): 色バンド判定・スパン結合・FSRS変換。
- **実PDF統合テスト** (任意): 実際のPDFに対して描画＋検出を実行（Node + @napi-rs/canvas）。
  ```bash
  # Windows (PowerShell)
  $env:ANKI_SHEET_TEST_PDF="C:\path\to\redsheet.pdf"; npm test
  ```
  例の財務諸表論PDF（252ページ）では約3,874個の語句を230ページから検出します。
- **ブラウザE2Eスモーク** (任意, Edgeを使用):
  ```bash
  npm run preview &     # 別ターミナルで
  ANKI_SHEET_TEST_PDF="...pdf" node scripts/e2e-smoke.mjs
  ```

## 実装状況

計画（`~/.claude/plans/`）の M0〜M6 を実装済み:

- M1: PDF取り込み → 自動検出 → ビジュアル・クローズカード → FSRS復習 → IndexedDB保存
- 赤シート・ビューア（「めくる」: 一括ON/OFF・個別タップ・ページめくり）
- M2: 取り込みの非ブロッキング化（ページ間で譲る・中止ボタン・進捗）
- M3: 色チューニングUI（ライブプレビュー・プリセット・見出し除外）＋ 再検出（IoUで進捗保持）
- M4: 複数デッキ管理・デッキ設定（名前・日次上限・目標保持率）
- M5: PWA（インストール/オフライン）＋ 全データのバックアップ書き出し/読み込み
- M6: キーボード操作・ダークモード

既知の調整ポイント:
- 章見出しのマゼンタも検出されることがあります。設定の「見出し除外（高さ倍率）」を下げるか、
  色相・しきい値を調整して再検出してください（ライブプレビューで確認できます）。
- 検出はメインスレッドで実行（252ページで数十秒。中止可）。pdf.jsのフォント描画が
  document を必要とするため、レンダリングのWeb Worker化は将来課題です。
