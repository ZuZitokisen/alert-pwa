# いぎなり東北産 public source boundary

Artist ID: `tohokusan`. Primary public source: https://madeintohoku.com/contents/schedule .

The hourly adapter fetches this public index and up to 24 same-origin numeric
article URLs. It identifies dates from schedule fields, never article publication
timestamps. It only admits a single LIVE/EVENT occurrence with matching detail
identity, explicit start and venue. Multiple sessions, unsupported markup,
conflicting weekdays/dates, external landing pages and cancellation/change notices
are rejected for separate review. It never infers removals, end times or ticket
windows. A partial result is not a claim of comprehensive coverage.

Transparent Node fetch was tested on 2026-11-19 against the real public source;
article https://madeintohoku.com/contents/1127556 yielded 2026-11-22 12:00 JST.
Other articles were rejected or had a fetch timeout, all recorded as diagnostics.
Scheduled GitHub-runner success must be observed separately after publication.
No authenticated endpoint, paid API, browser fingerprint, CAPTCHA bypass or new
credential is used. Redirects, oversized responses and cross-origin URLs fail closed.

Test fixtures are reconstructed minimal structural examples containing factual
names/dates/times/places, not redistributions of full source pages. Original page
copyright remains with its owners; no content license is asserted. Official
article URLs are retained for attribution. Official SNS and broadcast/organizer
sources are not automated by this adapter; separately verified broadcaster-only
items must remain `possible`, and fan claims are excluded.
