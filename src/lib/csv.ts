/** Minimal RFC 4180 CSV parser (quoted fields, embedded commas/newlines/quotes). */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let q = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (q) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else q = false;
			} else field += c;
		} else if (c === '"') q = true;
		else if (c === ',') {
			row.push(field);
			field = '';
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else field += c;
	}
	if (field !== '' || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows.filter((r) => r.length > 1 || r[0] !== '');
}

/** Parse CSV into objects keyed by header row. */
export function parseCsvObjects(text: string): Record<string, string>[] {
	const [head, ...rest] = parseCsv(text.replace(/^﻿/, ''));
	if (!head) return [];
	return rest.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])));
}

export function toCsv(rows: Record<string, unknown>[], fields: string[]): string {
	const esc = (v: unknown) => {
		const s = v == null ? '' : String(v);
		return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	return [fields.join(','), ...rows.map((r) => fields.map((f) => esc(r[f])).join(','))].join('\n') + '\n';
}
