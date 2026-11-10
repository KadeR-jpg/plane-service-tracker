/** Requests to the background refresh worker (workers/ingest) and its run status. */

export interface RefreshRun {
	id: number;
	trigger: string;
	status: 'downloading' | 'scoring' | 'done' | 'failed';
	started_at: string;
	finished_at: string | null;
	window_start: string | null;
	window_end: string | null;
	days_total: number;
	days_pending: number;
	days_failed: number;
	score_total: number;
	score_pending: number;
	message: string;
}

export async function requestRefresh(platform: App.Platform | undefined, trigger: 'upload' | 'manual'): Promise<boolean> {
	const q = platform?.env?.REFRESH_QUEUE;
	if (!q) return false;
	await q.send({ k: 'plan', trigger });
	return true;
}

export async function latestRefresh(db: D1Database): Promise<RefreshRun | null> {
	try {
		return await db.prepare('SELECT * FROM refresh_runs ORDER BY id DESC LIMIT 1').first<RefreshRun>();
	} catch {
		return null; // table missing before migration 0004
	}
}

export interface RefreshProgress {
	running: boolean;
	phase: 'downloading' | 'scoring' | null;
	daysDone: number;
	daysTotal: number;
	/** rough minutes until the run is done; null when unknown */
	etaMin: number | null;
}

/** Progress and a rough time estimate from the download rate so far. */
export function refreshProgress(r: RefreshRun | null, nowMs = Date.now()): RefreshProgress {
	const running = !!r && (r.status === 'downloading' || r.status === 'scoring');
	if (!r || !running) return { running: false, phase: null, daysDone: r?.days_total ?? 0, daysTotal: r?.days_total ?? 0, etaMin: null };
	const done = r.days_total - r.days_pending;
	let eta: number | null = null;
	if (r.status === 'scoring') eta = 5;
	else if (done > 0) {
		const elapsedMin = (nowMs - Date.parse(r.started_at)) / 60000;
		eta = Math.round((r.days_pending * elapsedMin) / done + 5);
	}
	return { running, phase: r.status as 'downloading' | 'scoring', daysDone: done, daysTotal: r.days_total, etaMin: eta };
}

export { etaText } from '$lib/eta';
