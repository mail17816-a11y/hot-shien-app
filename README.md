# Palette Link

TOIROの物件定期巡回管理サービス。TypeScript / React / Vite / Supabaseを使用。

## ローカル起動

Node.js 22.12以上で、`npm ci` を実行します。`.env.example` を `.env.local` にコピーし、公開キーを設定して `npm run dev`。本番ビルドは `npm run build`。

## Supabase初期設定

1. SQL Editorで `supabase/migrations/001_initial.sql` を初回のみ実行。既存の同名テーブルがある場合は実行前に確認してください。
2. Authenticationの公開サインアップを無効化し、Users画面から管理者・作業者・顧客のアカウントを作成します。
3. SQL Editorで次の例のメールアドレスを置き換えて、管理者と作業者の役割を設定します。顧客の初期役割はcustomerです。ユーザー自身による役割変更は許可していません。

```sql
update public.profiles set role='admin', name='管理者'
where id=(select id from auth.users where email='admin@example.com');
update public.profiles set role='worker', name='作業者'
where id=(select id from auth.users where email='worker@example.com');
```

4. 管理者としてログインし、顧客に紐付けた物件を登録します。
5. 作業者から写真付き報告を登録。顧客で閲覧・追加作業依頼、作業者で受付状況変更を確認します。

## Vercel

対象: https://vercel.com/minnou/hot-shien-app

GitHub `mail17816-a11y/hot-shien-app` を接続し、Framework PresetをViteに設定。Environment Variablesに以下を登録してください。秘密キーは不要です。

```
VITE_SUPABASE_URL=https://bwydtrphjvfiufhqxhzj.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=（受け取った公開キー）
```

## 実装範囲と制限

- パスワードログイン、役割別画面、管理者による物件登録とアカウント停止。
- 巡回／維持作業／郵便物対応の報告、非公開の写真保存、顧客のタイムライン。
- 顧客による追加作業依頼、作業者による状態変更。
- アカウント発行と役割設定はSupabase管理画面。請求、契約変更、データ一括取得、告知、アプリからのユーザー削除・バックアップは未実装。
- 作業者は事業所内すべての物件を閲覧可能。顧客は自分に紐付く物件のみ。顧客・作業者の役割や物件の紐付けはデータベースの権限でも制限。
- 写真リンクは1時間有効。期限切れは画面の更新で再取得。停止前に発行した写真リンクは有効期限まで使えます。
- 写真アップロード失敗時は登録途中の報告・写真を削除。ネットワーク切断による中断時は未完成の報告が残る場合があります。

## 公開前に確認すること

別々の顧客2名を作成し、互いの物件・報告・依頼・写真を取得できないことを確認してください。ログアウト状態でデータを取得できないこと、停止したアカウントで報告や依頼を操作できないことも確認します。SQLと実ユーザーでの動作確認が済むまで、実際の顧客データを登録しないでください。
