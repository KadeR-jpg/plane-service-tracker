import { describe, expect, it } from 'vitest';
import { candidatesFromCsvRows, candidatesFromWords, normalizeCandidates, type Word } from './candidates';
import { parseCsv } from './csv';

describe('candidate parsing', () => {
	it('maps CSV headers and normalizes hex', () => {
		const csv = 'Registration,Mode S Hex,FAA Model,Registered Owner,Owner City,Owner State\n' +
			'N406YC,A4C514,G-V,"A7P TRUST, INC",WILMINGTON,DE\n' +
			'999X,,GVI,NO HEX,BOISE,ID\n' +
			'N2AC,0xa18d54,BD-700,TVPX,SLC,UT\n' +
			'N2AC,A18D54,BD-700,TVPX,SLC,UT\n';
		const { rows, dropped, duplicates } = normalizeCandidates(candidatesFromCsvRows(parseCsv(csv)));
		expect(rows.map((r) => r.hex)).toEqual(['a4c514', 'a18d54']);
		expect(rows[0].registered_owner).toBe('A7P TRUST, INC');
		expect(dropped).toBe(1);
		expect(duplicates).toBe(1);
	});

	it('assigns PDF words to columns by header x position', () => {
		const w = (text: string, x0: number, top: number): Word => ({ text, x0, x1: x0 + text.length * 5, top });
		const page: Word[] = [
			w('Registration', 10, 50), w('Mode S Hex', 80, 50), w('FAA Model', 150, 50),
			w('Registered Owner', 230, 50), w('Owner City', 400, 50), w('Owner State', 480, 50),
			w('N406YC', 10, 70), w('A4C514', 80, 70), w('G-V', 150, 70), w('A7P TRUST CO', 230, 70),
			w('WILMINGTON', 400, 70), w('DE', 480, 70)
		];
		const { rows } = normalizeCandidates(candidatesFromWords([page]));
		expect(rows).toEqual([
			{ hex: 'a4c514', registration: 'N406YC', model: 'G-V', registered_owner: 'A7P TRUST CO', owner_city: 'WILMINGTON', owner_state: 'DE' }
		]);
	});
});
