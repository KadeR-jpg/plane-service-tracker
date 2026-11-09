/**
 * Public-record enrichment for the candidate aircraft.
 *
 *  - FAA Part 135 list (weekly spreadsheet on www.faa.gov): charter / management operator per N-number.
 *  - FAA aircraft registry (ReleasableAircraft.zip from registry.faa.gov, downloaded in a browser because the
 *    site blocks automated clients): MASTER.txt gives the full owner address and co-owners, DEREG.txt gives
 *    earlier registrations of the same airframe (matched on serial number).
 */
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { readSheet } from 'read-excel-file/node';
import { parseCsv } from '../../src/lib/csv.ts';

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

export interface RegistryRow {
	registration: string;
	serial: string;
	mfr_mdl_code: string;
	year_mfr: string;
	registrant_type: string;
	name: string;
	street: string;
	street2: string;
	city: string;
	state: string;
	zip: string;
	county: string;
	country: string;
	other_names: string;
	cert_issue_date: string;
	last_action_date: string;
	expiration_date: string;
	fract_owner: string;
	status_code: string;
}

export interface PriorRow {
	registration: string;
	prior_registration: string;
	name: string;
	street: string;
	city: string;
	state: string;
	zip: string;
	cert_issue_date: string;
	cancel_date: string;
}

const REGISTRANT_TYPES: Record<string, string> = {
	'1': 'Individual', '2': 'Partnership', '3': 'Corporation', '4': 'Co-Owned', '5': 'Government',
	'7': 'LLC', '8': 'Non-Citizen Corporation', '9': 'Non-Citizen Co-Owned'
};

/** YYYYMMDD -> YYYY-MM-DD */
const ymd = (s: string) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s);

/** Rows of a registry text file keyed by normalized header names (spaces/hyphens -> _). */
function registryRecords(text: string): Record<string, string>[] {
	const [head, ...rows] = parseCsv(text.replace(/^﻿/, ''));
	const keys = head.map((h) => h.trim().toUpperCase().replace(/[\s-]+/g, '_').replace(/[()]/g, ''));
	return rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

function zipEntry(files: Record<string, Uint8Array>, name: string): string | null {
	const key = Object.keys(files).find((k) => k.toUpperCase().endsWith(name));
	return key ? strFromU8(files[key]) : null;
}

/**
 * Parse ReleasableAircraft.zip and keep only the given N-numbers.
 * Earlier registrations come from DEREG.txt rows with the same serial number and model code.
 */
export function loadRegistry(zipPath: string, regs: Set<string>): { current: RegistryRow[]; prior: PriorRow[] } {
	const files = unzipSync(new Uint8Array(readFileSync(zipPath)), {
		filter: (f) => /(MASTER|DEREG)\.txt$/i.test(f.name)
	});
	const master = zipEntry(files, 'MASTER.TXT');
	if (!master) throw new Error('MASTER.txt not found in the zip (is it ReleasableAircraft.zip?)');
	const current: RegistryRow[] = [];
	for (const r of registryRecords(master)) {
		const registration = normN(r.N_NUMBER);
		if (!regs.has(registration)) continue;
		const others = [1, 2, 3, 4, 5].map((i) => r[`OTHER_NAMES${i}`] ?? '').filter(Boolean);
		current.push({
			registration,
			serial: r.SERIAL_NUMBER ?? '',
			mfr_mdl_code: r.MFR_MDL_CODE ?? '',
			year_mfr: r.YEAR_MFR ?? '',
			registrant_type: REGISTRANT_TYPES[r.TYPE_REGISTRANT ?? ''] ?? r.TYPE_REGISTRANT ?? '',
			name: r.NAME ?? '',
			street: r.STREET ?? '',
			street2: r.STREET2 ?? '',
			city: r.CITY ?? '',
			state: r.STATE ?? '',
			zip: r.ZIP_CODE ?? '',
			county: r.COUNTY ?? '',
			country: r.COUNTRY ?? '',
			other_names: others.join('; '),
			cert_issue_date: ymd(r.CERT_ISSUE_DATE ?? ''),
			last_action_date: ymd(r.LAST_ACTION_DATE ?? ''),
			expiration_date: ymd(r.EXPIRATION_DATE ?? ''),
			fract_owner: r.FRACT_OWNER ?? '',
			status_code: r.STATUS_CODE ?? ''
		});
	}
	const prior: PriorRow[] = [];
	const dereg = zipEntry(files, 'DEREG.TXT');
	if (dereg) {
		const bySerial = new Map(current.map((c) => [`${c.serial}|${c.mfr_mdl_code}`, c.registration]));
		for (const r of registryRecords(dereg)) {
			const reg = bySerial.get(`${r.SERIAL_NUMBER ?? ''}|${r.MFR_MDL_CODE ?? ''}`);
			if (!reg) continue;
			prior.push({
				registration: reg,
				prior_registration: normN(r.N_NUMBER),
				name: r.NAME ?? '',
				street: r.STREET_MAIL ?? r.STREET ?? '',
				city: r.CITY_MAIL ?? r.CITY ?? '',
				state: r.STATE_ABBREV_MAIL ?? r.STATE ?? '',
				zip: r.ZIP_CODE_MAIL ?? r.ZIP_CODE ?? '',
				cert_issue_date: ymd(r.CERT_ISSUE_DATE ?? ''),
				cancel_date: ymd(r.CANCEL_DATE ?? '')
			});
		}
	}
	return { current, prior };
}
