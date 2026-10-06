# 番号管理とexample.comのログインID

## 最終設計

| 項目 | 管理方法 |
| --- | --- |
| ログインID | 管理者が指定。全役割で重複不可、大文字小文字は区別しない |
| 内部認証メール | 小文字のログインID＋`@example.com`。実際のメール送信は使わない |
| 顧客番号 | 顧客のログインIDを大文字表記したもの。UUIDでAuthに紐付ける |
| 管理者・作業者 | 顧客番号を持たず、個別のログインIDを使う |
| 物件番号 | 管理者が入力。自動採番しない。重複不可、大文字で保存 |
| 既存物件の移行 | `LEGACY-`＋UUIDのハイフンを除いた文字列を暫定番号として付与 |

採番の接頭辞・連番形式は未決定です。技術上の入力制約だけを設けます。ログインIDは32文字以内、物件番号は64文字以内の半角英数字・ハイフン・アンダースコア（先頭は英数字）。同じIDを複数役割で共有しません。発行後のID変更・番号再利用は運用で禁止します。過去の物件番号もレコードを削除せず保持します。

業務DBの `profiles` は認証UUID、login_id、customer_number、role、activeを保存します。`properties` は物件UUID、property_number、契約者の認証UUID、作成日時を保存します。氏名・住所・自由な物件名・投稿者名の列は削除します。報告・依頼・メッセージ・写真との外部キーは維持します。

氏名・住所・連絡先・所在地はローカル台帳に保存し、クラウドにアップロードしません。顧客番号をローカル台帳の主キーに、物件番号を物件情報との照合に使います。

## アカウントの発行

SupabaseのAuthenticationで公開サインアップを無効にし、メール／パスワード方式だけを使用します。電話・SNS認証・メール招待・メールリセットは使いません。

管理者がUsers → Create new userで `指定ID@example.com` と個別のパスワードを入力し、Auto Confirm Userを選びます。DBはこのIDをプロフィールへ登録します。顧客番号や物件番号の連番を自動で生成する処理はありません。

新規ユーザーの初期役割はcustomerです。管理者・作業者にする場合は、以下の例のように役割変更とcustomer_numberの解除を同じSQLで行います。

```sql
update public.profiles set role='worker',customer_number=null
where id=(select id from auth.users where email='worker-a@example.com');
```

管理者はroleをadminにします。Webの物件登録画面では、契約者の顧客番号を選び、ローカル台帳と一致する物件番号を手入力します。

## 未適用の003を適用する手順

この003は以前の「自動採番版003」を置き換えたものです。旧版003が未実行のDB専用です。001/002を再実行しないでください。

003は旧氏名・住所・投稿者名の列とAuthのユーザーメタデータを削除します。必要な情報は事前にローカルで控えてください。通常のSQL操作で削除した内容を復元することはできません。作業中は利用とユーザー／物件の追加を止めます。

1. 既存アカウントに割り当てるログインIDを決めます。現在のメールが `有効なID@example.com` ならそのIDを継続使用できます。別の実メールやIDへ変える場合は、SQL適用前に下記スクリプトでAuthのAdmin APIを使用して変更します。アカウントの作り直しやauth.users.emailの直接SQL更新はしません。UUIDとパスワードは維持します。
2. 新しいメールが未確認なら、Admin APIのemail_confirm、または管理画面で確認済みにします。
3. 下記の対応表を必要に応じてローカル台帳へ控えます。個人情報を含むためチャット・GitHub・Driveへ貼り付けません。テストデータだけなら控えは不要です。

```sql
select p.id as auth_user_id,lower(split_part(u.email,'@',1)) as login_id,
 case when p.role='customer' then upper(split_part(u.email,'@',1)) end as customer_number,
 p.name as old_name,p.role
from public.profiles p join auth.users u on u.id=p.id order by p.id;

select p.id as property_id,
 'LEGACY-' || upper(replace(p.id::text,'-','')) as property_number,
 upper(split_part(u.email,'@',1)) as customer_number,
 p.name as old_property_name,p.address as old_address
from public.properties p join auth.users u on u.id=p.customer_id order by p.id;
```

4. 更新版 `supabase/migrations/003_identifier_only.sql` を一度だけ実行します。example.com形式ではないメールが存在する場合は、個人情報列の削除前にエラーで停止し、変更はロールバックされます。Authの氏名・住所を含みうるuser_metadataも空にします。
5. 更新版アプリを公開します。旧アプリは削除された列を使うため、この間は利用できません。
6. ログインID＋従来のパスワードでログインし、番号表示・物件登録・報告や投稿・顧客間の閲覧分離を確認します。

003適用後はDBトリガーでexample.com以外の認証メールと既存ログインIDの変更を拒否します。ユーザーメタデータは常に空へ戻します。メール形式のAuth識別子はクラウドに残りますが、実際の顧客メールを保存しません。

## 既存認証メールの変更用スクリプト

`node scripts/set-login-identifiers.mjs 対応表.json` は確認だけです。`--apply` を付けた場合だけAdmin APIへ更新します。実行環境はNode.js 24以上です。対応表には既存ユーザーUUIDと指定するlogin_idだけを記載します。

```json
[
 {"user_id":"既存ユーザーのUUID","login_id":"C000001"},
 {"user_id":"既存作業者のUUID","login_id":"worker-a"}
]
```

変更時には `SUPABASE_URL` とサーバー専用の `SUPABASE_SECRET_KEY` をローカル環境変数で設定します。キーはチャットやGitHubへ貼らず、ブラウザ公開変数（VITE_）にも設定しません。このスクリプトはブラウザで使いません。

```text
node scripts/set-login-identifiers.mjs 対応表.json
node scripts/set-login-identifiers.mjs 対応表.json --apply
```

更新はユーザーごとに行います。途中でエラーになったら、完了したUUIDの出力を確認し、重複するIDを修正して再実行します。003適用後のログインID変更用途には使えません。パスワードの再設定は電話／書面で本人確認した管理者が別途行います。管理者側のアカウント発行画面は今回実装せず、当面はSupabase管理画面を使用します。

## 今回変更しない情報

写真と自由記述は運用側で検討するため保持します。過去のバックアップ・ログ・外部認証のidentity_dataはこのSQLでは消去しません。外部認証を使った履歴がある場合、その個人情報は別途確認が必要です。請求・決済のデータ構造は次の実装範囲です。
