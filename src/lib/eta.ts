/** Human wording for a minutes estimate (shared by server and pages). */
export function etaText(min: number | null): string {
	if (min == null) return 'soon';
	if (min < 60) return `in about ${Math.max(5, Math.round(min / 5) * 5)} minutes`;
	const h = min / 60;
	return `in about ${h < 1.75 ? '1½' : Math.round(h)} hours`;
}
