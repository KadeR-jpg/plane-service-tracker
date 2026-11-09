/** Research links and owner classification for the prospect dossier. */

export interface Link {
	label: string;
	href: string;
	note?: string;
}

const q = encodeURIComponent;

/** Owners that are trustees or banks: the trust beneficiary is not public, so the operator is the route in. */
export function isTrustee(owner: string): boolean {
	return /\bTRUSTEE\b|\bTRUST (CO|COMPANY)\b|\bBANK\b.*\bTRUST|\bWILMINGTON TRUST\b|\bOWNER TRUST\b/i.test(owner);
}

export function isLlc(owner: string): boolean {
	return /\bL\.?L\.?C\.?\b|\bLC\b/i.test(owner);
}

/** Business-entity search pages, by state (name entry is manual on these sites). */
const SOS: Record<string, { name: string; href: string }> = {
	DE: { name: 'Delaware Division of Corporations', href: 'https://icis.corp.delaware.gov/ecorp/entitysearch/namesearch.aspx' },
	UT: { name: 'Utah Business Search', href: 'https://businessregistration.utah.gov/EntitySearch/OnlineEntitySearch' },
	MT: { name: 'Montana Business Search', href: 'https://biz.sosmt.gov/search/business' },
	ID: { name: 'Idaho Business Search', href: 'https://sosbiz.idaho.gov/search/business' },
	WY: { name: 'Wyoming Business Search', href: 'https://wyobiz.wyo.gov/Business/FilingSearch.aspx' },
	WA: { name: 'Washington Corporations Search', href: 'https://ccfs.sos.wa.gov/#/BusinessSearch' },
	NV: { name: 'Nevada Business Search', href: 'https://esos.nv.gov/EntitySearch/OnlineEntitySearch' },
	FL: { name: 'Florida Sunbiz', href: 'https://search.sunbiz.org/Inquiry/CorporationSearch/ByName' },
	CA: { name: 'California bizfile', href: 'https://bizfileonline.sos.ca.gov/search/business' },
	CO: { name: 'Colorado Business Search', href: 'https://www.coloradosos.gov/biz/BusinessEntityCriteriaExt.do' },
	AZ: { name: 'Arizona eCorp', href: 'https://ecorp.azcc.gov/EntitySearch/Index' },
	OR: { name: 'Oregon Business Registry', href: 'https://egov.sos.state.or.us/br/pkg_web_name_srch_inq.login' }
};

/** Entity-search links: the owner's mailing state first, then the common formation states. */
export function entityLinks(owner: string, ownerState: string): Link[] {
	if (!owner) return [];
	const links: Link[] = [
		{
			label: 'OpenCorporates (all states)',
			href: `https://opencorporates.com/companies?q=${q(owner)}&jurisdiction_code=`,
			note: 'formation state, registered agent, officers'
		}
	];
	const states = [...new Set([ownerState.toUpperCase(), 'DE', 'WY', 'NV'].filter(Boolean))];
	for (const st of states) {
		const s = SOS[st];
		if (s) links.push({ label: `${s.name}`, href: s.href, note: st === ownerState.toUpperCase() ? 'owner mailing state' : 'common formation state' });
	}
	return links;
}

/** People searches at a company: aviation decision makers. */
export function peopleLinks(company: string): Link[] {
	if (!company) return [];
	const roles = ['director of aviation', 'chief pilot', 'director of maintenance', 'aviation manager'];
	return [
		...roles.map((r) => ({
			label: `LinkedIn: ${r}`,
			href: `https://www.linkedin.com/search/results/people/?keywords=${q(`"${company}" ${r}`)}`
		})),
		{ label: 'Google: company + aviation', href: `https://www.google.com/search?q=${q(`"${company}" aviation`)}` }
	];
}

export function aircraftLinks(registration: string, hex: string, serial = ''): Link[] {
	const n = registration.toUpperCase();
	const links: Link[] = [
		{ label: 'FAA registry record', href: `https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=${q(n.replace(/^N/, ''))}` },
		{ label: 'adsb.lol live map', href: `https://globe.adsb.lol/?icao=${q(hex)}` },
		{ label: 'Planespotters', href: `https://www.planespotters.net/search?q=${q(n)}`, note: 'photos, history' },
		{ label: 'RZJets (via Google)', href: `https://www.google.com/search?q=${q(`site:rzjets.net ${n}`)}`, note: 'airframe history' },
		{ label: 'Google: registration', href: `https://www.google.com/search?q=${q(`"${n}"`)}` }
	];
	if (serial) links.push({ label: 'Google: serial number', href: `https://www.google.com/search?q=${q(`"${serial}" aircraft serial`)}` });
	return links;
}

export const STATUSES = [
	{ value: 'new', label: 'New' },
	{ value: 'researching', label: 'Researching' },
	{ value: 'contacted', label: 'Contacted' },
	{ value: 'customer', label: 'Customer' },
	{ value: 'not_a_fit', label: 'Not a fit' }
] as const;
export type Status = (typeof STATUSES)[number]['value'];
export const statusLabel = (s: string | null | undefined) => STATUSES.find((x) => x.value === s)?.label ?? 'New';
