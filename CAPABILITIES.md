# iOS PWAでの可否と今回の実装範囲

2026-11-11確認。6項目はいずれも条件付きで実現可能ですが、この静的確認版で実配信・実同期は動いていません。

1. **同日に複数通知**: Web Pushで可能。予定・変更・通知時刻を区別した識別子で、意図しない置換と二重送信を防ぎます。通知の表示・時刻・必達はOS、通信、設定の影響を受けます。
2. **予定名や具体情報を通知に含める**: title/bodyに予定名、日時、場所、変更内容などを設定可能。OSの省略表示やロック画面のプライバシー設定で見え方が変わります。今回実装は画面内プレビューです。
3. **取得後の即時通知**: サーバーが取得・検証・保存した後に速やかにPushを送信できます。「取得直後」と「公式発表の瞬間」は異なり、到達時刻は保証できません。GitHub Pagesや閉じたPWAだけで常時巡回はできません。
4. **本体カレンダー追加**: 個別/複数VEVENTのICS生成が可能。AppleはiPhoneのMailから.icsを読み込む方法を案内しています。PWAからの保存だけでカレンダー登録完了とはなりません。通常のPWAからネイティブEventKitを直接操作できるわけではありません。実機で読込導線を確認する必要があります。
5. **カード化・ソート・まとめて登録**: カード、絞り込み、並べ替え、複数選択とICS生成を今回実装。アプリ内選択とOSカレンダーへの一括登録は別です。更新・重複処理は読込先に依存します。
6. **個人のお気に入り**: 端末のブラウザ内保存を今回実装。別端末との同期には認証とバックエンドが必要。保存領域は消去される可能性があります。

## Web Pushと予約通知の条件

- iOS/iPadOS 16.4以降のホーム画面に追加したWebアプリ、HTTPS、Service Worker、利用者の操作を起点にした通知許可が必要です。
- Apple Developer Programへの加入はWeb Pushの必須条件ではありません。
- 閉じたアプリのリマインドにはサーバー側の予約・送信を基本とします。長時間のsetTimeout、Notificationのtimestamp、背景での定期同期を、確実な予約通知として扱いません。
- 予定の変更・中止による古い予約の無効化、再試行、重複抑止、タイムゾーン、購読解除や失効を扱う必要があります。
- iOS 18.4以降のDeclarative Web Pushは追加の選択肢ですが、任意時刻のローカル通知予約を保証するものではありません。
- 通知本文に何を出すかは利用者が選べるようにし、ロック画面への情報表示にも配慮します。

## 一次資料・仕様

- [WebKit: Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [Apple: Sending web push notifications in web apps and browsers](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)
- [MDN: showNotification](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification)
- [MDN: Notification tag](https://developer.mozilla.org/en-US/docs/Web/API/Notification/tag)
- [MDN: Offline and background operation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)
- [Apple: iPhoneでカレンダーを設定する](https://support.apple.com/en-mn/guide/iphone/ipha0d932e96/ios)
- [Apple: EventKit](https://developer.apple.com/documentation/eventkit)
- [RFC 5545: iCalendar](https://datatracker.ietf.org/doc/html/rfc5545)
- [WebKit: Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/)
- [WebKit: Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/)
- [Apple HIG: Layout](https://developer.apple.com/design/human-interface-guidelines/layout)
- [Apple HIG: Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)
- [Apple HIG: Notifications](https://developer.apple.com/design/human-interface-guidelines/notifications)
