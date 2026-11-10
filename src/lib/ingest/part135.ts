/**
 * FAA Part 135 operator / aircraft list (weekly spreadsheet on www.faa.gov), runtime-neutral:
 * the caller supplies a sheet reader (read-excel-file/node or /universal).
 */
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

/** Download the current spreadsheet (the file name changes, so it is found via the FAA page). */
export async function downloadPart135(): Promise<ArrayBuffer> {
	const page = await fetch(P135_PAGE);
	if (!page.ok) throw new Error(`Part 135 page: HTTP ${page.status}`);
	const m = /href="([^"]+\.xlsx?)"/i.exec(await page.text());
	if (!m) throw new Error('Part 135 page: no spreadsheet link found');
	const res = await fetch(new URL(m[1], 'https://www.faa.gov').toString());
	if (!res.ok) throw new Error(`Part 135 list: HTTP ${res.status}`);
	return res.arrayBuffer();
}

export function parsePart135(rows: unknown[][]): Part135Row[] {
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
