/** Node loader: downloads OurAirports CSVs into data/ on first use and builds the airport index. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Airports, buildAirportRecords, type AirportRecord } from '../../src/lib/ingest/airports.ts';

export { Airports, nm, type Airport } from '../../src/lib/ingest/airports.ts';

const SRC = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main';

async function ensure(file: string, dir: string): Promise<string> {
	const path = `${dir}/${file}`;
	if (!existsSync(path)) {
		mkdirSync(dir, { recursive: true });
		const res = await fetch(`${SRC}/${file}`);
		if (!res.ok) throw new Error(`download ${file}: HTTP ${res.status}`);
		writeFileSync(path, await res.text());
	}
	return readFileSync(path, 'utf8');
}

export async function loadAirportRecords(dir = 'data'): Promise<AirportRecord[]> {
	return buildAirportRecords(await ensure('airports.csv', dir), await ensure('runways.csv', dir));
}

export async function loadAirports(dir = 'data'): Promise<Airports> {
	return Airports.fromRecords(await loadAirportRecords(dir));
}
