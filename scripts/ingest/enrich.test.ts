import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { loadPart135, readRegistry } from './enrich.ts';

const P135 = process.env.P135_XLSX;

describe('FAA registry zip', () => {
	it('parses MASTER and matches DEREG rows by serial + model code', async () => {
		const master =
			'﻿N-NUMBER,SERIAL NUMBER,MFR MDL CODE,ENG MFR MDL,YEAR MFR,TYPE REGISTRANT,NAME,STREET,STREET2,CITY,STATE,ZIP CODE,REGION,COUNTY,COUNTRY,LAST ACTION DATE,CERT ISSUE DATE,CERTIFICATION,TYPE AIRCRAFT,TYPE ENGINE,STATUS CODE,MODE S CODE,FRACT OWNER,AIR WORTH DATE,OTHER NAMES(1),OTHER NAMES(2),OTHER NAMES(3),OTHER NAMES(4),OTHER NAMES(5),EXPIRATION DATE,UNIQUE ID,KIT MFR, KIT MODEL,MODE S CODE HEX,\r\n' +
			'100BD,70234        ,1390052,54553,2025,7,TVPX AIRCRAFT SOLUTIONS INC TRUSTEE                ,39 E EAGLERIDGE DR STE 201         ,                                 ,NORTH SALT LAKE   ,UT,840543003 ,2,011,US,20250301,20250115,1T,5,5,V ,50002321,     ,20250110,ACME HOLDINGS LLC       ,                ,                ,                ,                ,20320131,01234567,       ,       ,A004D1    ,\r\n' +
			'999ZZ,1           ,1111111,54553,2000,1,NOBODY                                            ,1 MAIN ST                          ,                                 ,BOISE             ,ID,83702     ,2,001,US,20200101,20200101,1T,5,5,V ,50000000,     ,20200101,                        ,                ,                ,                ,                ,20270131,01234568,       ,       ,A00000    ,\r\n';
		const dereg =
			'N-NUMBER,SERIAL-NUMBER,MFR-MDL-CODE,STATUS-CODE,NAME,STREET-MAIL,STREET2-MAIL,CITY-MAIL,STATE-ABBREV-MAIL,ZIP-CODE-MAIL,ENG-MFR-MDL,YEAR-MFR,CERTIFICATION,REGION,COUNTY-MAIL,COUNTRY-MAIL,AIR-WORTH-DATE,CANCEL-DATE,MODE-S-CODE,INDICATOR-GROUP,EXP-COUNTRY,LAST-ACT-DATE,CERT-ISSUE-DATE\r\n' +
			'7PZ  ,70234        ,1390052,A,BOMBARDIER AVIATION SERVICES,200 CHEMIN,,DORVAL,QC,H4S1Y9,54553,2025,1T,2,,CA,20241201,20250114,5,,,20250114,20241201\r\n' +
			'7QQ  ,70234        ,9999999,A,OTHER MODEL SAME SERIAL,1 X ST,,X,TX,1,54553,2025,1T,2,,US,20241201,20250114,5,,,20250114,20241201\r\n';
		// real zip order: DEREG before MASTER
		const zip = zipSync({ 'DEREG.txt': strToU8(dereg), 'MASTER.txt': strToU8(master) });
		const { current, prior } = await readRegistry(zip, new Set(['N100BD']));
		expect(current).toHaveLength(1);
		expect(current[0]).toMatchObject({
			registration: 'N100BD', serial: '70234', registrant_type: 'LLC', name: 'TVPX AIRCRAFT SOLUTIONS INC TRUSTEE',
			street: '39 E EAGLERIDGE DR STE 201', city: 'NORTH SALT LAKE', state: 'UT', zip: '840543003',
			other_names: 'ACME HOLDINGS LLC', cert_issue_date: '2025-01-15', expiration_date: '2032-01-31'
		});
		expect(prior).toEqual([
			expect.objectContaining({ registration: 'N100BD', prior_registration: 'N7PZ', name: 'BOMBARDIER AVIATION SERVICES', state: 'QC', cancel_date: '2025-01-14' })
		]);
	});
});

describe.runIf(P135)('FAA Part 135 list', () => {
	it('parses the real spreadsheet', async () => {
		const rows = await loadPart135(P135);
		expect(rows.length).toBeGreaterThan(5000);
		expect(rows[0].registration).toMatch(/^N[0-9A-Z]+$/);
		expect(rows[0].operator).not.toBe('');
	});
});
