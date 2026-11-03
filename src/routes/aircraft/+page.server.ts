import { db, results } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform }) => ({ rows: await results(db(platform)) });
