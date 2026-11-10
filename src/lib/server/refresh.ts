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
