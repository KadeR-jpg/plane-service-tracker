declare global {
	namespace App {
		interface Locals {
			user: import('$lib/server/auth').User | null;
		}
		interface Platform {
			env: {
				DB: D1Database;
			};
			ctx: ExecutionContext;
			caches: CacheStorage & { default: Cache };
		}
	}
}

export {};
