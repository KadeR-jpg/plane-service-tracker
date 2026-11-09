/** Column labels and plain-language definitions shared by every table and export page. */
export interface Term {
	label: string;
	help: string;
}

export const TERMS = {
	registration: { label: 'Registration', help: 'FAA N-number from the candidate list.' },
	hex: { label: 'Mode S hex', help: 'Transponder address used to match the aircraft in ADS-B data.' },
	model: { label: 'Model', help: 'FAA model from the candidate list.' },
	registered_owner: {
		label: 'Registered owner',
		help: 'Owner on the FAA registration. Often a trust, LLC or management company rather than the real user.'
	},
	owner_city_state: { label: 'Owner city/state', help: 'Mailing address city and state on the FAA registration.' },
	top_airport: {
		label: 'Top overnight airport',
		help: 'Airport where the aircraft spent the most tracked nights, anywhere in the country.'
	},
	top_airport_share: {
		label: '% of nights there',
		help: 'Share of tracked nights spent at the top overnight airport.'
	},
	nights_observed: {
		label: 'Nights tracked',
		help: 'Nights where we know where the aircraft was parked at 3 AM local time (anywhere). Nights with no data are not counted.'
	},
	nights_in_region: {
		label: 'Nights in region',
		help: 'Of the tracked nights, how many it was parked at an airport in the service region.'
	},
	region_share: {
		label: 'Region share',
		help: 'Nights in region ÷ nights tracked. The main "is it based here" signal: 100% means every known night was in the region.'
	},
	landings_in_region: {
		label: 'Landings in region',
		help: 'Arrivals at in-region airports, including day trips. High landings with a low region share usually means a visitor (second home, seasonal, charter).'
	},
	landings_total: { label: 'Landings (all)', help: 'Arrivals at any airport in the window.' },
	first_seen: { label: 'First seen', help: 'First day the aircraft appears in the ADS-B window.' },
	last_seen: { label: 'Last seen', help: 'Last day the aircraft appears in the ADS-B window.' },
	region_airports: {
		label: 'In-region airports',
		help: 'Each in-region airport as IDENT:<nights>n/<landings>l, e.g. KBZN:12n/5l = 12 nights and 5 landings at Bozeman.'
	}
} satisfies Record<string, Term>;

export type TermKey = keyof typeof TERMS;

/** Order used by the definitions panel. */
export const GLOSSARY_ORDER: TermKey[] = [
	'nights_observed',
	'nights_in_region',
	'region_share',
	'top_airport',
	'top_airport_share',
	'landings_in_region',
	'region_airports',
	'registered_owner'
];
