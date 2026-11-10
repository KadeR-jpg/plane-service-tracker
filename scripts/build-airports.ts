/** Regenerate workers/ingest/src/airports.json from OurAirports (data/ is downloaded on first use). */
import { writeFileSync } from 'node:fs';
import { loadAirportRecords } from './ingest/airports.ts';

const records = await loadAirportRecords(process.argv[2] ?? 'data');
writeFileSync('workers/ingest/src/airports.json', JSON.stringify(records));
console.log(`${records.length} airports -> workers/ingest/src/airports.json`);
