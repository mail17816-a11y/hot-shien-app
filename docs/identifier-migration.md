# 顧客・物件を番号で管理するDB設計

クラウド側には氏名・住所・自由な物件名を保存する列を設けません。ローカル台帳は顧客番号を主キーとして氏名・住所を管理し、物件番号に物件の所在地や詳細を紐付けます。台帳ファイルをGitHubやSupabase、Google Driveへアップロードしないでください。

| クラウドの表 | 保存する識別情報 |
| --- | --- |
| profiles | 認証UUID、顧客番号（顧客のみ）、役割、利用停止状態 |
| properties | 物件UUID、物件番号、契約者の認証UUID、作成日時 |
| reports | 物件UUID、作業者の認証UUID、作業種別・日付・本文・写真パス |
| work_requests | 物件UUID、顧客の認証UUID、依頼種別・本文・対応状況 |
| property_messages | 物件UUID、投稿者の認証UUID・役割、種別・本文・投稿日時 |

顧客番号は `C000001`、物件番号は `P000001` 形式でDBが採番します。内部UUIDは外部キーとRLSでの本人照合に残します。画面には顧客番号・物件番号を表示し、スタッフの実名は扱いません。顧客のアカウントはSupabase管理画面で作成し、発行された顧客番号をローカル台帳へ記入します。契約変更・アカウント登録・再設定の本人確認は電話／書面で行います。

## 既存DBの移行

`003_identifier_only.sql` は氏名・住所・投稿者名の列を削除するため、列の値は通常のSQL操作では復元できません。クラウドの過去バックアップや認証情報まで削除するSQLではありません。

1. 作業中は登録・アカウント作成を止めてください。
2. 必要な場合は次の照合表をSQL Editorで確認し、台帳用PCなどのローカルにだけ控えます。これは個人情報を含むのでチャット・GitHub・Driveへ貼り付けないでください。テストデータだけなら控えは不要です。

```sql
-- 移行で付与される顧客番号と旧氏名の対応
select id as auth_user_id,
       'C' || lpad(row_number() over(order by id)::text,6,'0') as customer_number,
       name as old_name
from public.profiles where role='customer' order by id;

-- 移行で付与される物件番号と旧物件情報の対応
with customers as (
 select id, 'C' || lpad(row_number() over(order by id)::text,6,'0') as customer_number
 from public.profiles where role='customer'
)
select p.id as property_id,
       'P' || lpad(row_number() over(order by p.id)::text,6,'0') as property_number,
       c.customer_number,p.name as old_property_name,p.address as old_address
from public.properties p left join customers c on c.id=p.customer_id order by p.id;
```

3. `001` と `002` が適用済みのプロジェクトに `003_identifier_only.sql` を一度だけ実行します。番号対応表の確認後に新しい顧客や物件を追加した場合、対応表を再確認してください。
4. 番号対応版のアプリをデプロイし、新しいデプロイのVisitから開きます。旧アプリは氏名・住所の列を使うため、移行とアプリ更新の間は利用できません。
5. 顧客A/Bの閲覧分離、物件登録、報告・依頼・メッセージの表示を確認します。顧客番号の変更はローカル台帳との照合を伴うため、一般ユーザーに更新権限を与えていません。

管理者・作業者へ役割を変える場合の例（氏名は登録しません）：

```sql
update public.profiles set role='worker',customer_number=null
where id=(select id from auth.users where email='worker-a@example.com');
```

## 今回の対象外と残る情報

写真・報告本文・依頼本文・メッセージ本文は運用側で検討するため変更していません。これらに記載済みの個人情報は別途確認が必要です。

Supabase Authのメールアドレス、ユーザーメタデータ、外部認証情報もこの移行では変更しません。実在するメールアドレスや名前をAuthに登録した場合はクラウドに残ります。氏名や住所のメタデータを登録せず、番号を使うログイン方式・Auth情報の整理は次の対応として扱います。DBの列削除はSupabaseの既存バックアップ・ログの消去を意味しません。

請求・決済のデータ構造は今回追加していません。今後は顧客番号を参照し、料金案内・決済経路・手動での入金登録を実装します。
