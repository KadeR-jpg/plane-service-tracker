/**
 * FAA aircraft registry (ReleasableAircraft.zip) reader, shared by the browser upload and the CLI.
 *
 * The zip is ~60 MB and MASTER.txt ~180 MB, so entries are inflated as a stream and read line by line;
 * only lines whose N-number (MASTER) or serial number (DEREG) matches a candidate are split into fields.
 * Fields are comma-separated without quoting; header names are normalized (spaces/hyphens -> _).
 */
import { Unzip, UnzipInflate } from 'fflate';

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

const ymd = (s: string) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s);
export const normN = (v: string) => {
	const s = v.trim().toUpperCase().replace(/\s+/g, '');
	return s && !s.startsWith('N') ? 'N' + s : s;
};
const normKey = (h: string) => h.trim().replace(/^﻿/, '').toUpperCase().replace(/[\s-]+/g, '_').replace(/[()]/g, '');

type Rec = Record<string, string>;

/** Calls onLine for each text line of the named zip entries, streaming. */
async function eachLine(
	zip: Uint8Array,
	names: RegExp,
	onLine: (entry: string, line: string) => void
): Promise<Set<string>> {
	const seen = new Set<string>();
	const pending: Promise<void>[] = [];
	const unzip = new Unzip((file) => {
		const base = file.name.split('/').pop()!.toUpperCase();
		if (!names.test(base)) return;
		seen.add(base);
		const dec = new TextDecoder();
		let rest = '';
		pending.push(
			new Promise<void>((resolve, reject) => {
				file.ondata = (err, chunk, final) => {
					if (err) return reject(err);
					const text = rest + dec.decode(chunk, { stream: !final });
					const lines = text.split(/\r?\n/);
					rest = final ? '' : lines.pop()!;
					for (const l of lines) if (l) onLine(base, l);
					if (final) resolve();
				};
				file.start();
			})
		);
	});
	unzip.register(UnzipInflate);
	const step = 1 << 20;
	for (let i = 0; i < zip.length; i += step) {
		unzip.push(zip.subarray(i, i + step), i + step >= zip.length);
		// let the browser repaint between megabytes
		if ((i / step) % 8 === 7) await new Promise((r) => setTimeout(r, 0));
	}
	await Promise.all(pending);
	return seen;
}

/** Feeds each line of one registry text file to onLine; resolves false if the file is not there. */
export type LineSource = (onLine: (line: string) => void) => Promise<boolean>;

/** One text file inside ReleasableAircraft.zip. */
export function zipSource(zip: Uint8Array, name: 'MASTER.TXT' | 'DEREG.TXT'): LineSource {
	return async (onLine) => (await eachLine(zip, new RegExp(`^${name.replace('.', '\\.')}$`), (_e, l) => onLine(l))).has(name);
}

/** An unzipped MASTER.txt / DEREG.txt given as a byte stream (e.g. File.stream() in the browser). */
export function streamSource(stream: ReadableStream<Uint8Array>): LineSource {
	return async (onLine) => {
		const reader = stream.getReader();
		const dec = new TextDecoder();
		let rest = '';
		let n = 0;
		for (;;) {
			const { value, done } = await reader.read();
			const text = rest + (done ? dec.decode() : dec.decode(value, { stream: true }));
			const lines = text.split(/\r?\n/);
			rest = done ? '' : lines.pop()!;
			for (const l of lines) if (l) onLine(l);
			if (done) break;
			if (++n % 16 === 0) await new Promise((r) => setTimeout(r, 0));
		}
		return true;
	};
}

/** Parse ReleasableAircraft.zip, keeping only the given N-numbers and earlier registrations of those airframes. */
export function readRegistryZip(zip: Uint8Array, regs: Set<string>, progress?: (msg: string) => void) {
	return readRegistry({ master: zipSource(zip, 'MASTER.TXT'), dereg: zipSource(zip, 'DEREG.TXT') }, regs, progress);
}

/** Registry rows for the given N-numbers, from MASTER (current) and optionally DEREG (earlier registrations). */
export async function readRegistry(
	src: { master: LineSource; dereg?: LineSource },
	regs: Set<string>,
	progress: (msg: string) => void = () => {}
): Promise<{ current: RegistryRow[]; prior: PriorRow[] }> {
	// Pass 1: MASTER.txt (current owners). It supplies the serial numbers DEREG rows are matched on,
	// and DEREG.txt precedes it in the zip, so DEREG is read in a second pass.
	progress('Reading current registrations (MASTER.txt)…');
	let mh: string[] | null = null;
	const masterRecs: Rec[] = [];
	const found = await src.master((line) => {
		if (!mh) {
			mh = line.split(',').map(normKey);
			return;
		}
		if (!regs.has(normN(line.slice(0, line.indexOf(','))))) return;
		const f = line.split(',');
		masterRecs.push(Object.fromEntries(mh.map((k, i) => [k, (f[i] ?? '').trim()])));
	});
	if (!found) throw new Error('MASTER.txt not found. Choose ReleasableAircraft.zip, or MASTER.txt and DEREG.txt from it.');
	if (!mh || !(mh as string[]).includes('N_NUMBER')) throw new Error('That file is not the FAA MASTER.txt (no N-NUMBER column).');

	const current: RegistryRow[] = masterRecs.map((r) => ({
		registration: normN(r.N_NUMBER ?? ''),
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
		other_names: [1, 2, 3, 4, 5].map((i) => r[`OTHER_NAMES${i}`] ?? '').filter(Boolean).join('; '),
		cert_issue_date: ymd(r.CERT_ISSUE_DATE ?? ''),
		last_action_date: ymd(r.LAST_ACTION_DATE ?? ''),
		expiration_date: ymd(r.EXPIRATION_DATE ?? ''),
		fract_owner: r.FRACT_OWNER ?? '',
		status_code: r.STATUS_CODE ?? ''
	}));

	// Pass 2: DEREG.txt (cancelled registrations), matched to current airframes on serial + model code
	progress('Reading earlier registrations (DEREG.txt)…');
	const prior: PriorRow[] = [];
	const bySerial = new Map(current.map((c) => [`${c.serial}|${c.mfr_mdl_code}`, c.registration]));
	const serials = new Set(current.map((c) => c.serial));
	let dh: string[] | null = null;
	let iSerial = 1;
	if (src.dereg) await src.dereg((line) => {
		if (!dh) {
			dh = line.split(',').map(normKey);
			iSerial = dh.indexOf('SERIAL_NUMBER');
			return;
		}
		{
			const f = line.split(',');
			if (!serials.has((f[iSerial] ?? '').trim())) return;
			const r: Rec = Object.fromEntries(dh.map((k, i) => [k, (f[i] ?? '').trim()]));
			const reg = bySerial.get(`${r.SERIAL_NUMBER}|${r.MFR_MDL_CODE}`);
			if (!reg) return;
			prior.push({
				registration: reg,
				prior_registration: normN(r.N_NUMBER ?? ''),
				name: r.NAME ?? '',
				street: r.STREET_MAIL ?? r.STREET ?? '',
				city: r.CITY_MAIL ?? r.CITY ?? '',
				state: r.STATE_ABBREV_MAIL ?? r.STATE ?? '',
				zip: r.ZIP_CODE_MAIL ?? r.ZIP_CODE ?? '',
				cert_issue_date: ymd(r.CERT_ISSUE_DATE ?? ''),
				cancel_date: ymd(r.CANCEL_DATE ?? '')
			});
		}
	});
	// DEREG can repeat a registration; keep one row per (airframe, N-number, owner, cancel date)
	const uniq = [...new Map(prior.map((p) => [`${p.registration}|${p.prior_registration}|${p.name}|${p.cancel_date}`, p])).values()];
	return { current, prior: uniq };
}
