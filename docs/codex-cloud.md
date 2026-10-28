# Codex Cloudで作業を引き継ぐ

## リポジトリ側で準備済みのもの

- `AGENTS.md`: 会話に依存しない開発方針・構成・公開先。
- `.nvmrc`: 推奨Node.js 24系。
- `scripts/codex-cloud-setup.sh`: 依存関係をpackage-lock.jsonどおりにインストール。
- `docs/`: ユーザー管理、実費、簡易契約、請求公開・撤回の設計と操作。

最新コードはGitHub `mail17816-a11y/hot-shien-app` のmainが基準です。ローカルPCの未コミット変更、`.env.local`、オフライン顧客台帳、Google Driveのファイルは自動で取り込まれません。`desktop/`のローカル開発も、このWeb版のクラウド引き継ぎには含めません。

## 最初のクラウド環境

OpenAI公式ガイドを2026年10月20日に確認しています。画面の名称が異なる場合は、環境作成の会話に下のセットアップ依頼文を渡してください。

1. ChatGPT/Codexの「Work in → Cloud」から環境選択を開き、「Create environment」を選びます。設定の「Codex Cloud → Environments」から作成する経路もあります。
2. GitHubを接続し、`mail17816-a11y/hot-shien-app`を選びます。
3. Node.js 24系、npmを使い、リポジトリ直下で `bash scripts/codex-cloud-setup.sh` を実行するよう依頼します。Install script欄がある場合もこのコマンドを指定できます。
4. `npm test` と `npm run build` の実行結果を確認します。開発サーバーが必要な場合は `npm run dev -- --host 0.0.0.0 --port 5173` を指定します。
5. 環境の準備結果を確認してPublishし、公開完了後にその環境から作業を始めます。既存環境を変更した場合はRepublish後、新しいタスクで使用します。

セットアップ依頼文：

```text
mail17816-a11y/hot-shien-appを開発する環境を用意してください。
最新mainのAGENTS.mdとdocs/codex-cloud.mdを読み、Node.js 24系とnpmを使用してください。
リポジトリ直下でbash scripts/codex-cloud-setup.shを実行し、npm testとnpm run buildを検証してください。
最初は実DBに接続せず、tests/billing-preview.htmlなどのサンプルで画面を確認できます。
本番DB変更、実ユーザー操作、請求の公開・撤回は環境準備に含めません。
```

## 外部接続と環境変数

コード編集、DB権限のローカルテスト、ビルドには、本番キーも外部DBも不要です。実ログインを使う画面確認では次の通常の環境変数を設定します。

```dotenv
VITE_SUPABASE_URL=https://bwydtrphjvfiufhqxhzj.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=管理画面の公開キーを設定
```

これらはブラウザへ渡る公開用の値です。公開キーをNetwork secretの置換用プレースホルダーだけでフロントエンドに埋め込まないでください。Supabaseのservice_role／secretキーはVITE_変数にしません。admin-users関数のサーバー用キーはSupabase側の組み込み環境変数を使用します。

このデスクトップで接続したSupabase・Vercel・Driveの認証がクラウドでも使えるとは仮定しません。クラウド側で利用可能な接続を確認し、必要なサービスだけを追加設定します。認証のない状態でも、変更・テスト・PR作成までを進められる構成です。GitHub書き込み権限は別途必要です。

ネットワークは依存パッケージの取得先を許可します。実DBに接続する場合は `bwydtrphjvfiufhqxhzj.supabase.co`、管理APIを利用する場合はその利用先など、必要なホストを追加します。クラウド環境には環境変数と許可されたHTTPS宛先用のNetwork secretsを設定する機能があります。秘密の設定は環境の設定画面で行い、チャットやGitへ貼り付けません。

Vercelの環境変数とCodex Cloudの環境変数は、それぞれの実行環境で確認してください。クラウド設定を済ませただけではVercel側の値は変更されません。

## 開発の開始プロンプト

```text
Palette Linkの開発を続けます。最新mainから作業してください。
AGENTS.mdとdocs/codex-cloud.mdを読み、今回変更する機能の関連ドキュメントも確認してください。
今回の依頼：［ここに変更内容を書く］
変更後は適切な検証を行い、結果を示してPRにまとめてください。
```

既存の会話内容はAGENTS.mdとdocsに要約しています。新しいクラウドの会話がこのチャット全文を自動で参照できるとは仮定せず、追加の要望は開始プロンプトに書いてください。

## 実装済みと既知の範囲

- IDログイン、admin/worker/customer、管理者のユーザー登録・役割・停止・パスワード再設定・履歴保持削除。
- 物件管理・ユーザー管理の分離と検索。物件の新規登録は折りたたみ。
- 物件コミュニケーション、作業・問い合わせ受付、4種類の表示チェックと濃い緑のチェック色。
- 作業報告と実費の同時登録。管理者は請求作成・公開後も理由付きで実費を訂正でき、有効な請求情報への同期・顧客への訂正通知・編集履歴表示に対応。
- 顧客・物件に紐づく毎月／年1回／一回のみ／カスタムの簡易契約、料金表の入力補助、定額と実費の請求下書き、顧客への公開。
- 顧客ごとの公開請求撤回、履歴保持、実費解除、同月の再作成。
- 決済・返金・入金登録、実費以外の公開請求の差額調整、自動税額・日割り・季節割増計算、新着通知・既読は未実装です。

本番の適用状態は作業時に再確認します。2026年10月19日までに、このリポジトリの撤回機能用SQLまで適用した記録があります。SQLの名前を見ただけで全件を再実行しないでください。

## 公式ガイド

- https://learn.chatgpt.com/docs/cloud
- https://learn.chatgpt.com/docs/environments/cloud-environments

この文書とスクリプトはリポジトリ側の準備です。ユーザーのクラウド環境の作成・Publish・接続完了を意味するものではありません。
