/** Service region: MT, ID, WY, eastern WA (lon > -120.5), northern UT (lat > 39.5). */
export function inRegion(isoRegion: string, lat: number, lon: number): boolean {
	if (isoRegion === 'US-MT' || isoRegion === 'US-ID' || isoRegion === 'US-WY') return true;
	if (isoRegion === 'US-WA' && lon > -120.5) return true;
	if (isoRegion === 'US-UT' && lat > 39.5) return true;
	return false;
}

/** Thresholds for "likely based" */
export const BASED_MIN_SHARE = 0.5;
export const BASED_MIN_NIGHTS = 10;
