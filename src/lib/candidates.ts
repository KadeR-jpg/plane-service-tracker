/** Candidate list normalization and column detection (shared by browser upload and server). */

export interface Candidate {
	hex: string;
	registration: string;
	model: string;
	registered_owner: string;
	owner_city: string;
	owner_state: string;
}

export type Field = keyof Candidate;
export const FIELDS: Field[] = ['registration', 'hex', 'model', 'registered_owner', 'owner_city', 'owner_state'];

/** Header aliases, most specific first. */
const HEADER_KEYS: Record<Field, string[]> = {
	registration: ['registration', 'n-number', 'n number', 'nnumber', 'tail', 'reg'],
	hex: ['mode s hex', 'mode-s hex', 'modes hex', 'mode s code', 'mode s', 'hex', 'icao24', 'icao'],
	model: ['faa model', 'aircraft model', 'model', 'type'],
	registered_owner: ['registered owner', 'owner name', 'registrant', 'owner', 'name'],
	owner_city: ['owner city', 'city'],
	owner_state: ['owner state', 'state', 'st']
};

export function normHex(v: string | undefined): string {
	const s = (v ?? '').trim().toLowerCase().replace(/^0x/, '').replace(/[^0-9a-f]/g, '');
	return s.length > 0 && s.length <= 6 ? s.padStart(6, '0') : '';
}

export function normReg(v: string | undefined): string {
	const s = (v ?? '').trim().toUpperCase().replace(/\s+/g, '');
	return !s || s.startsWith('N') ? s : 'N' + s;
}

/** Map header cell texts to field -> column index; null unless a hex column is present. */
export function mapHeader(cells: string[]): Partial<Record<Field, number>> | null {
	const norm = cells.map((c) => (c ?? '').trim().toLowerCase().replace(/\s+/g, ' '));
	const m: Partial<Record<Field, number>> = {};
	const used = new Set<number>();
	for (const field of ['hex', 'owner_city', 'owner_state', 'registered_owner', 'model', 'registration'] as Field[]) {
		for (const k of HEADER_KEYS[field]) {
			const i = norm.findIndex((c, idx) => !used.has(idx) && (c === k || (k.length > 3 && c.includes(k))));
			if (i >= 0) {
				m[field] = i;
				used.add(i);
				break;
			}
		}
	}
	return m.hex !== undefined ? m : null;
}

/** Normalize, drop rows without a valid hex, dedupe by hex. */
export function normalizeCandidates(raw: Partial<Record<Field, string>>[]): {
	rows: Candidate[];
	dropped: number;
	duplicates: number;
} {
	const seen = new Set<string>();
	const rows: Candidate[] = [];
	let dropped = 0;
	let duplicates = 0;
	for (const r of raw) {
		const hex = normHex(r.hex);
		if (hex.length !== 6) {
			dropped++;
			continue;
		}
		if (seen.has(hex)) {
			duplicates++;
			continue;
		}
		seen.add(hex);
		rows.push({
			hex,
			registration: normReg(r.registration),
			model: (r.model ?? '').trim(),
			registered_owner: (r.registered_owner ?? '').trim(),
			owner_city: (r.owner_city ?? '').trim(),
			owner_state: (r.owner_state ?? '').trim()
		});
	}
	return { rows, dropped, duplicates };
}

/** CSV: header row mapped by alias. */
export function candidatesFromCsvRows(rows: string[][]): Partial<Record<Field, string>>[] {
	let map: Partial<Record<Field, number>> | null = null;
	const out: Partial<Record<Field, string>>[] = [];
	for (const r of rows) {
		if (!map) {
			map = mapHeader(r);
			continue;
		}
		const rec: Partial<Record<Field, string>> = {};
		for (const [f, i] of Object.entries(map) as [Field, number][]) rec[f] = r[i] ?? '';
		out.push(rec);
	}
	return out;
}

/** Positioned text from a PDF page (pdf.js text items, y measured from top). */
export interface Word {
	text: string;
	x0: number;
	x1: number;
	top: number;
}

/**
 * Tables without ruling lines: find a header line, take each header label's left x as a
 * column start, then assign each data word to the right-most column starting at or left of it.
 * `cols` carries over between pages for lists whose header is printed only once.
 */
export function candidatesFromWords(
	pages: Word[][],
	gap = 8
): Partial<Record<Field, string>>[] {
	const out: Partial<Record<Field, string>>[] = [];
	let cols: [number, Field][] | null = null;
	for (const words of pages) {
		const lines = new Map<number, Word[]>();
		for (const w of words) {
			if (!w.text.trim()) continue;
			const k = Math.round(w.top / 3);
			const key = lines.has(k - 1) ? k - 1 : lines.has(k + 1) ? k + 1 : k;
			if (!lines.has(key)) lines.set(key, []);
			lines.get(key)!.push(w);
		}
		for (const key of [...lines.keys()].sort((a, b) => a - b)) {
			const ws = lines.get(key)!.sort((a, b) => a.x0 - b.x0);
			const labels: Word[][] = [[ws[0]]];
			for (const w of ws.slice(1)) {
				const cur = labels[labels.length - 1];
				if (w.x0 - cur[cur.length - 1].x1 > gap) labels.push([w]);
				else cur.push(w);
			}
			const hm = mapHeader(labels.map((l) => l.map((w) => w.text).join(' ')));
			if (hm) {
				cols = (Object.entries(hm) as [Field, number][])
					.map(([f, i]) => [labels[i][0].x0, f] as [number, Field])
					.sort((a, b) => a[0] - b[0]);
				continue;
			}
			if (!cols) continue;
			const rec: Partial<Record<Field, string>> = {};
			for (const w of ws) {
				let field = cols[0][1];
				for (const [x0, f] of cols) if (w.x0 + 2 >= x0) field = f;
				rec[field] = ((rec[field] ?? '') + ' ' + w.text).trim();
			}
			if (rec.hex || rec.registration) out.push(rec);
		}
	}
	return out;
}
