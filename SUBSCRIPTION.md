# 共通予定の購読カレンダー: ローカル試作

購読用フィードの公開・端末登録・配信検証はしていません。実データの収集/公開パイプラインは未接続です。このコードだけでiPhoneに自動反映される状態にはなりません。

## 追加ファイル

- `subscription-core.js`: DOM/ネットワーク/保存/権限操作を行わない純粋関数。ブラウザーではfeature-core.jsの後に読み込むと`AlertSubscriptions`、Nodeではrequireで使えます。
- `test-subscription-core.mjs`: 架空予定による購読回帰テスト。
- `generate-subscription-demo.mjs`: 実行すると`subscription-demo/`に架空の10個のICSとstate.jsonを生成。実予定や個人設定を読みません。毎回同じ初期fixtureを生成するだけで、運用更新用CLIではありません。

既存feature-core.jsの`parseInstant`、`dateKey`、TEXTエスケープ、UTF-8折返しを再利用します。既存buildICSにも出典＋IDの安定UIDはありますが、今回はartist分離、変更日時の永続化、取消・区分移動の管理を別実装しています。

## API / データ契約

`reconcile(publicEvents, previousState, { now: ISO日時 })` → 新しいstate。
`buildFeed(state, presetId)` → `{ics, included, skipped, demo:true, readyToSubscribe:false}`。
`planSelection(presetIds)` → `{selected, removed, warning}`。
`PRESETS` → 仮の選択肢。具体的区分/名称はユーザー確定事項ではありません。

入力は`visibility:'public', demo:true`が必須です。本試作から実データを公開できるようにする変更は別レビューにしてください。artistIdはtokisen/re-ge、categoryはlive/benefit/media/otherの単一値。source/idは空でない文字列です。

出力用allowlistはartistId/source/id/category/title/start/end/allDay/location/publicNote/statusのみ。お気に入り、検索、個人分類、端末カレンダー、任意note等を取り込みません。publicNoteなど公開用欄に個人情報を混ぜない責務は収集側に残ります。プライバシー保証のため、UIのフィルター結果やlocalStorageを生成入力に流用しないでください。

任意の`sourceRevision`（0以上の安全な整数）を渡せます。一度改訂番号付きで取り込んだ予定は、それより古い番号・番号なし・同番号なのに異なる内容を拒否します。新しい番号でも公開内容が同じならICSのSEQUENCE/DTSTAMPは変えません。番号なし入力は収集側が時系列順に適用する契約で、遅着検知はできません。実運用パイプラインでは単調なsourceRevisionを必須にしてください。

保存stateはreconcile/buildFeed双方で検証し、identity/UID一致、重複key、SEQUENCE範囲、時刻形式・順序、前回日時、区分整合を確認します。破損は例外にして公開を止め、余分なフィールドはallowlist再構成で除きます。壊れたstateを無言で空stateに置き換えてはいけません。

同一artist/source/idの重複入力はエラーです。収集側で出典の改訂順を解決してください。異なる出典の同じ現実イベントを自動統合しません。将来、収集側の正規イベントID対応表が必要です。共同出演イベントもartistごとに別identityです。複数artist購読に跨る同一現実公演の重複は、この試作では自動解決できません。

## 安定性・更新・削除

- UIDは固定namespace＋artist/source/id。タイトル・時刻・区分の変更で変わりません。現在のexample.invalidは配送先ではなく試作用UID名前空間です。運用前に名前空間を確定し、公開開始後は変更禁止です。
- 内容が変わったときだけSEQUENCEを1増やし、DTSTAMP/LAST-MODIFIEDを更新。CREATEDは維持。同じ入力を翌日再生成してもICSのバイトは同じです。SEQUENCEは0〜2147483647。
- stateは生成側で永続化必須。再起動で消すと改訂番号がリセットされ、更新追従を壊します。新stateと全feedを同じ世代として検証・原子的に公開する運用が必要です。現コードは保存・公開しません。
- 入力はパッチです。省略/取得失敗/空配列で過去の予定を消しません。取得元から消えた場合は`missing`を明示し、TENTATIVE＋掲載消失の注意を保持。中止と断定しません。
- `cancelled`は予定中止、`withdrawn`は配信取り下げ。どちらも元UIDのSTATUS:CANCELLEDを残しますが、後者は中止を意味しないと明記。端末が非表示にするか取消表示するかは未検証です。
- 区分変更では旧feedに取消レコード、新feedに有効レコードを載せます。全予定feedは取消にしません。取消レコードは無期限保持。安全な保持期限は未決定で、勝手に削除しません。
- source/id/artistを変更すると別予定になります。IDの訂正は旧identityの明示取り下げ＋新identityの作成が必要です。

## 時刻・確度

- 時刻付き予定はUTCで出力。タイムゾーン省略入力は既存coreと同じJST。
- 日付のみ＋allDay:trueは本来の終日予定。DTENDは排他的な終了日です。
- 日付のみ＋allDay:falseはDATE値の仮表示にして、タイトル・説明に「時刻未定」「終日開催という意味ではありません」と明記。時刻を捏造しません。
- 初回から日付不明の予定は出力しません。公開済みの日時が不明に変わった場合は前回日時を保持し、TENTATIVE＋「最後に確認した日時を仮表示」と明記。勝手に消えたり確定時刻に見えたりすることを避けます。
- `possible`は「かも？」＋TENTATIVE。`unknown`/`missing`もTENTATIVE。終了不明はDTEND/DURATIONを生成しません。VALARMや招待送信はありません。
- ICSはCRLF、TEXTエスケープ、UTF-8で75オクテット以下の行折返し。空feedでも有効なVCALENDARを返します。

## 仮プリセットとUI統合案

artist別にall/live/benefit/media/otherの5区分、計10候補。文言は「全予定」「ライブ・イベント」「特典会・応募」「メディア」「その他」で、すべて仮です。予定は1つの主区分のみ。ライブと応募のように別日時を持つ事柄は収集側で別の予定IDにする必要があります。

1. 「本体カレンダーで購読」パネルにartistと「全予定 / 種類別」を表示。現在は「準備中・実配信未接続」とし、登録ボタンを有効にしない。
2. PRESETSを選択候補に使い、全予定と内訳の同時選択はplanSelectionで正規化。内訳同士は重ならない設計です。同じUIDでも別のカレンダー間でOSが重複排除するとは仮定しません。
3. すでに本体へ追加済みの購読はWebアプリから検出/解除できません。「切り替え時は旧購読を解除」の注意を出す。解除操作はユーザーが本体で行います。
4. 読み取り専用、反映に遅延あり、完全な即時反映は保証しないと表示。個別ICSダウンロードとは別の導線にする。
5. 実URLへアクセスしHTTPS GETで200、ICS本文、キャッシュ/更新動作を確認してから購読リンクを提供。ユーザーの選択をクエリー付きカスタムURLに送らず、固定公開feedのURLを使う。今回webcal URLを生成しません。

GitHub Pagesは静的feedを置けますが、収集・改訂stateの保存・公開ジョブは別途必要です。配信失敗で空feedに置き換えない、SWでfeedを古いまま固定しない、個人設定を公開リポジトリへ書き込まないこと。サーバーの通常アクセスログに固定feedの取得リクエストが残り得る点は、アプリが個人のカレンダー内容を送信することとは別です。

## 検証

`node --test test-subscription-core.mjs test-feature-core.mjs test-demo-store.mjs`

58件通過（購読18件＋既存40件）。安定UID、異artist/出典同ID、改訂、変更なし再生成、取消/復帰、掲載消失、区分移動、日付のみ/不明、注入/Unicode折返し、allowlist、選択重複、空feed、入力エラーを検証。

`node generate-subscription-demo.mjs`は架空fixtureのローカル生成だけです。公開、push、OS操作、実iPhoneの購読、更新/削除反映、webcal起動、HTTP Content-Type/キャッシュ実配信はいずれも未検証です。
