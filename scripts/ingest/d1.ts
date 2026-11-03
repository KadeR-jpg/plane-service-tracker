/** D1 access through the wrangler CLI (uses your `wrangler login` session). */
import { execFileSync } from 'node:child_process';

export type Target = '--local' | '--remote';

function wrangler(args: string[]): string {
	return execFileSync('npx', ['wrangler', ...args], {
		encoding: 'utf8',
		maxBuffer: 256 << 20,
		stdio: ['ignore', 'pipe', 'inherit']
	});
}

export function query<T>(sql: string, target: Target): T[] {
	const out = wrangler(['d1', 'execute', 'DB', target, '--json', '--command', sql]);
	const parsed = JSON.parse(out) as { results: T[] }[];
	return parsed.flatMap((r) => r.results);
}

export function executeFile(file: string, target: Target) {
	wrangler(['d1', 'execute', 'DB', target, '--yes', '--file', file]);
}

export function sqlValue(v: unknown): string {
	if (v === null || v === undefined) return 'NULL';
	if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
	return `'${String(v).replace(/'/g, "''")}'`;
}

/** Multi-row INSERT statements, `chunk` rows each. */
export function inserts(table: string, cols: string[], rows: unknown[][], chunk = 200): string[] {
	const out: string[] = [];
	for (let i = 0; i < rows.length; i += chunk) {
		const vals = rows
			.slice(i, i + chunk)
			.map((r) => `(${r.map(sqlValue).join(',')})`)
			.join(',\n');
		out.push(`INSERT INTO ${table} (${cols.join(',')}) VALUES\n${vals};`);
	}
	return out;
}
