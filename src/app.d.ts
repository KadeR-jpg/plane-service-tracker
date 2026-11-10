declare global {
	namespace App {
		interface Locals {
			user: import('$lib/server/auth').User | null;
		}
		interface Platform {
			env: {
				DB: D1Database;
				REFRESH_QUEUE?: Queue<{ k: 'plan'; trigger: 'upload' | 'manual' }>;
			};
			ctx: ExecutionContext;
			caches: CacheStorage & { default: Cache };
		}
	}
}

export {};
