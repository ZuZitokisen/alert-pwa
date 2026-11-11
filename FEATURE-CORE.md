# 架空サンプル用の共通ロジック

`feature-core.js` は外部依存のない `globalThis.AlertFeatures` を提供します。Nodeでは `require('./feature-core.js')` で同じ関数を使えます。DOM、localStorage、通知許可、ネットワーク、Push、タイマー、カレンダーへの書き込みは行いません。

## 識別・表示

- `stableEventKey(event)` または `stableEventKey(source, id)` は出典と予定IDの組を識別します。片方がない場合は `null`。お気に入りもこのキーを使い、異なる出典の同じIDを混ぜません。
- `deduplicateEvents(events)` は出典＋IDごとに最大の整数revisionを採用します。同じrevisionなら後の入力を採用します。
- `filterEvents(events, {artist, artistId, category, status, query, favoritesOnly, favorites, sort})` は入力を変更せず、重複排除・絞り込み・並べ替えします。`artistId`、`artist`、`artists` に対応。`favorites` はキーのSet、配列、trueを持つオブジェクト。`status:'missing'` は掲載消失を選択します。
- `sort` は `date` / `date-desc` / `favorites` / `favorites-first` / `title` / `artist` / `category` / `status` / `newest` / `revision`。日時不明は日時順の末尾です。
- `dateKey(value)` はJSTの `YYYY-MM-DD`、不正・未定なら `null`。タイムゾーンのないISO日時はJSTとして扱います。日付のみから時刻は推測しません。
- `overlapsDay(event, day)` は終日・時刻付き終了を排他的に扱います。終日の終了日、または午前0時終了の翌日は含めません。終了不明は既知の開始日のみ表示します。
- `notificationPreview(eventOrChange)` は `{title, body, tag, data}`。具体的な予定名、時刻、場所、内容、根拠と架空表示を含む文字列です。画面には `textContent` で表示してください。OS通知は生成しません。

## ICSファイルの内容生成

`buildICS(eventOrEvents, {now})` は `{ics, included, skipped, demo:true}` を返します。`included` は採用された予定、`skipped` は `{event,key,reason,label}` を含む除外理由です。全件除外なら `ics` は空文字列です。`exportEligibility(event)` で事前確認できます。

- すべてのタイトル・説明に架空サンプル表示。可能性の予定は「かも？」＋`STATUS:TENTATIVE`。
- 安定UIDは出典＋ID由来。revisionを`SEQUENCE`へ。時刻はUTCへ変換。
- 文字列をRFC 5545 TEXT形式でエスケープし、物理行はUTF-8で75バイト以内。CR/LFからのプロパティ注入を防止します。
- 中止・掲載消失・日付未定・時刻未定の非終日予定・不正な終了は除外。
- 終日には`VALUE=DATE`と入力どおりの排他的終了日。終了不明なら`DTEND`も`DURATION`も作りません。
- `VALARM`、招待、送信、OSカレンダーへの自動登録はありません。ファイル読込先によって同一UIDの更新・重複処理が異なるため、重複しないことは保証しません。

## 過去ルールのリマインド候補プレビュー

`reminderTimes(event, {now, morningTime:'08:00', mode})` は、`times`（未来の候補）、`unresolved`（日時未定など）、`omitted`（過去・開始以降の朝候補など）を返します。各候補にはUTCの`at`、ミリ秒`timestamp`、`kind/kinds`、`label/labels`、`eventKey`を持ちます。同時刻の候補は1つにまとめます。

- `morning1h`: 開始日の朝時刻（既定08:00 JST）＋開始1時間前。
- `deadline2`: 明示された`deadline`（または`deadlineAt`）の当日朝＋締切1時間前。過去ルールの特例としてJST 23:59締切は23:00 JSTを使い、22:59にはしません。
- mode省略時は明示された締切があれば`deadline2`、なければ`morning1h`。両方のアンカーを混ぜません。終日の排他的終了日を締切に変換しません。
- 朝時刻が開始・締切と同時または後なら朝候補を省略。早朝・午前0時開始の1時間前は前日になります。現在時刻と同時・過去の候補は省略します。
- 日付のみ、終日の開始時刻、締切不明は推測しません。中止・掲載消失は候補にしません。
- この規則は記録で確認できた**過去の実装のプレビュー**です。現行の既存アプリとの一致、実機通知、実配信は未検証。返り値の`historicalPreview:true`、`currentTTMVerified:false`、`ruleNote`でも区別します。

## 自動テスト

`node --test test-feature-core.mjs test-demo-store.mjs`

ICS注入・Unicodeの行折返し・終了不明・日付のみ・終日・出典＋IDの重複排除・お気に入り順・JST境界・朝候補省略・深夜・09:00開始時の重複抑止・23:59締切特例を検証します。ブラウザー連携・OSカレンダー読込・通知配信のテストではありません。
