/** Time-zone helpers built on Intl (no tz database dependency beyond the runtime). */
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function fmt(tz: string) {
	let f = fmtCache.get(tz);
	if (!f) {
		f = new Intl.DateTimeFormat('en-US', {
			timeZone: tz,
			hourCycle: 'h23',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
		fmtCache.set(tz, f);
	}
	return f;
}

function parts(epochMs: number, tz: string) {
	const p: Record<string, number> = {};
	for (const x of fmt(tz).formatToParts(new Date(epochMs))) if (x.type !== 'literal') p[x.type] = Number(x.value);
	return p;
}

/** UTC offset (ms) of tz at the instant epochMs. */
export function offsetMs(epochMs: number, tz: string): number {
	const p = parts(epochMs, tz);
	return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(epochMs / 1000) * 1000;
}

/** Local calendar date (YYYY-MM-DD) of an epoch-seconds instant in tz. */
export function localDate(epochS: number, tz: string): string {
	const p = parts(epochS * 1000, tz);
	return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Epoch seconds of local wall time `date` (YYYY-MM-DD) at `hour`:00 in tz. */
export function epochAtLocal(date: string, hour: number, tz: string): number {
	const [y, m, d] = date.split('-').map(Number);
	const guess = Date.UTC(y, m - 1, d, hour);
	let t = guess - offsetMs(guess, tz);
	t = guess - offsetMs(t, tz);
	return t / 1000;
}

export function addDays(date: string, n: number): string {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
