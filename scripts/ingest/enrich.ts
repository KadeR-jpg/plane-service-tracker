/**
 * Public-record enrichment for the candidate aircraft (CLI side).
 *
 *  - FAA Part 135 list: charter / management operator per N-number (src/lib/ingest/part135.ts).
 *  - FAA aircraft registry (ReleasableAircraft.zip, downloaded in a browser because registry.faa.gov
 *    blocks automated clients): full owner address, co-owners, earlier registrations (src/lib/faa.ts).
 */
import { readFileSync } from 'node:fs';
import { readSheet } from 'read-excel-file/node';
import { downloadPart135, parsePart135, type Part135Row } from '../../src/lib/ingest/part135.ts';

export { normN, type Part135Row } from '../../src/lib/ingest/part135.ts';
export { readRegistryZip, type PriorRow, type RegistryRow } from '../../src/lib/faa.ts';

/** Parse the FAA Part 135 list from a local file, or download the current one. */
export async function loadPart135(file?: string): Promise<Part135Row[]> {
	const buf = file ? readFileSync(file) : Buffer.from(await downloadPart135());
	return parsePart135((await readSheet(buf)) as unknown[][]);
}
