declare global {
	namespace App {
		interface Platform {
			env: {
				DB: D1Database;
				ADMIN_TOKEN?: string;
			};
			ctx: ExecutionContext;
			caches: CacheStorage & { default: Cache };
		}
	}
}

export {};
