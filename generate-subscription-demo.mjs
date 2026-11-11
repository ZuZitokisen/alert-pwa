// LOCAL FICTIONAL FIXTURES ONLY. No fetch, publish, login or device actions.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import S from './subscription-core.js';
const output = new URL('./subscription-demo/', import.meta.url);
await mkdir(output, { recursive: true });
const base = { visibility: 'public', demo: true, source: 'fictional-demo', category: 'live', status: 'confirmed' };
const events = [
  { ...base, artistId: 'tokisen', id: 'sample-1', title: '架空の公演', start: '2026-12-01T18:00:00+09:00' },
  { ...base, artistId: 're-ge', id: 'sample-1', title: '架空のメディア予定', start: '2026-12-03', category: 'media', status: 'possible' }
];
const state = S.reconcile(events, null, { now: '2026-11-11T00:00:00Z' });
await writeFile(new URL('state.json', output), JSON.stringify(state, null, 2) + '\n');
for (const preset of S.PRESETS) await writeFile(new URL(preset.id + '.ics', output), S.buildFeed(state, preset.id).ics);
console.log(`Generated ${S.PRESETS.length} fictional local feeds and a fixture state in ${fileURLToPath(output)}. Not published or ready to subscribe.`);
