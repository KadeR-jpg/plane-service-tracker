/**
 * Public-record enrichment for the candidate aircraft.
 *
 *  - FAA Part 135 list (weekly spreadsheet on www.faa.gov): charter / management operator per N-number.
 *  - FAA aircraft registry (ReleasableAircraft.zip from registry.faa.gov, downloaded in a browser because the
 *    site blocks automated clients): MASTER.txt gives the full owner address and co-owners, DEREG.txt gives
 *    earlier registrations of the same airframe (matched on serial number).
 */
import { readFileSync } from 'node:fs';
import { readSheet } from 'read-excel-file/node';

const P135_PAGE = 'https://www.faa.gov/about/officeorg/headquartersoffices/avs/faa-certificated-aircraft-operators-legal-part-135-holders';

export interface Part135Row {
	registration: string;
	operator: string;
	designator: string;
	chdo: string;
	cfr: string;
	model: string;
	serial: string;
}

const clean = (v: unknown) => (v == null ? '' : String(v).trim());
export const normN = (v: unknown) => {
	const s = clean(v).toUpperCase().replace(/\s+/g, '');
	return s && !s.startsWith('N') ? 'N' + s : s;
};

async function part135Url(): Promise<string> {
	const res = await fetch(P135_PAGE);
	if (!res.ok) throw new Error(`Part 135 page: HTTP ${res.status}`);
	const html = await res.text();
	const m = /href="([^"]+\.xlsx?)"/i.exec(html);
	if (!m) throw new Error('Part 135 page: no spreadsheet link found');
	return new URL(m[1], 'https://www.faa.gov').toString();
}

/** Download and parse the FAA Part 135 operator/aircraft list. */
export async function loadPart135(file?: string): Promise<Part135Row[]> {
	let buf: Buffer;
	if (file) buf = readFileSync(file);
	else {
		const url = await part135Url();
		const res = await fetch(url);
		if (!res.ok) throw new Error(`Part 135 list: HTTP ${res.status}`);
		buf = Buffer.from(await res.arrayBuffer());
	}
	const rows = (await readSheet(buf)) as unknown[][];
	const head = rows[0].map((h) => clean(h).toLowerCase());
	const col = (re: RegExp) => head.findIndex((h) => re.test(h));
	const ix = {
		cfr: col(/^cfr/),
		chdo: col(/chdo/),
		dsgn: col(/dsgn|designator/),
		name: col(/^name|operator|certificate holder/),
		model: col(/m\/m\/s|model/),
		reg: col(/registration|n-number/),
		serial: col(/serial/)
	};
	if (ix.reg < 0 || ix.name < 0) throw new Error(`Part 135 list: unexpected columns ${head.join(', ')}`);
	const out: Part135Row[] = [];
	for (const r of rows.slice(1)) {
		const registration = normN(r[ix.reg]);
		if (!registration) continue;
		out.push({
			registration,
			operator: clean(r[ix.name]),
			designator: clean(r[ix.dsgn]),
			chdo: clean(r[ix.chdo]),
			cfr: clean(r[ix.cfr]),
			model: clean(r[ix.model]),
			serial: clean(r[ix.serial])
		});
	}
	return out;
}

export { readRegistryZip, type PriorRow, type RegistryRow } from '../../src/lib/faa.ts';
