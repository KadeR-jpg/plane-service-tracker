<script lang="ts">
	import Glossary from '$lib/Glossary.svelte';
	import Th from '$lib/Th.svelte';
	import { etaText } from '$lib/eta';
	let { data } = $props();
	const pct = (x: number) => `${Math.round(x * 100)}%`;
	const q = $derived(`minShare=${data.minShare}&minNights=${data.minNights}`);
</script>

<svelte:head><title>Regional Base Finder</title></svelte:head>

<h1>ULR large-cabin aircraft based in region</h1>
<p class="muted">
	MT, ID, WY, eastern WA (east of −120.5°), northern UT (north of 39.5°). Based on 03:00-local overnight
	locations from adsb.lol ADS-B history, not FAA registered addresses.
	{#if data.run}
		History window <strong>{data.run.window_start} to {data.run.window_end}</strong> ({data.run.days} days), last
		ingest {data.run.finished_at.slice(0, 16).replace('T', ' ')} UTC.
	{:else}
		No ingest run yet.
	{/if}
</p>

{#if data.progress.running}
	<p class="card banner">
		<strong>Flight history is updating</strong>
		({data.progress.phase === 'scoring' ? 'recalculating scores' : `${data.progress.daysDone} of ${data.progress.daysTotal} days downloaded`}),
		finishing {etaText(data.progress.etaMin)}.
		{#if data.partialCount}{data.partialCount} newly added aircraft show partial results so far.{/if}
		{#if data.missingCount}{data.missingCount} aircraft have no history yet; they fill in as days download.{/if}
		<a href="/candidates">Details</a>
	</p>
{/if}

<div class="stats">
	<div class="card stat"><div class="v">{data.totals.candidates}</div><div class="l">Candidates</div></div>
	<div class="card stat"><div class="v">{data.totals.seen}</div><div class="l">Seen in ADS-B window</div></div>
	<div class="card stat"><div class="v">{data.totals.active}</div><div class="l">Any in-region activity</div></div>
	<div class="card stat"><div class="v">{data.totals.based}</div><div class="l">Likely based</div></div>
</div>

<form class="inline card" method="GET">
	<label title="Share of tracked nights parked in the region">Min region share <input name="minShare" type="number" step="0.05" min="0" max="1" value={data.minShare} /></label>
	<label title="Minimum nights with a known 3 AM location">Min nights tracked <input name="minNights" type="number" step="1" min="0" value={data.minNights} /></label>
	<button type="submit">Apply</button>
	<span class="muted" style="margin-left:auto">
		Export:
		<a href="/export/regional_base_candidates.csv">regional_base_candidates.csv</a> ·
		<a href="/export/overnights.csv">overnights.csv</a> ·
		<a href="/export/summary.md?{q}">summary.md</a>
	</span>
</form>

<Glossary />

<h2>Likely based ({data.based.length})</h2>
<p class="muted">
	Parked in the region on at least {Math.round(data.minShare * 100)}% of tracked nights, with at least {data.minNights}
	nights tracked.
</p>
{#if data.based.length}
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<Th k="registration" /><Th k="model" /><Th k="registered_owner" /><Th k="top_airport" />
					<Th k="top_airport_share" num /><Th k="nights_observed" num /><Th k="nights_in_region" num />
					<Th k="region_share" /><Th k="landings_in_region" num /><Th k="last_seen" />
				</tr>
			</thead>
			<tbody>
				{#each data.based as r (r.hex)}
					<tr>
						<td><a href="/aircraft/{r.hex}">{r.registration || r.hex}</a></td>
						<td>{r.model}</td>
						<td class="wrap">{r.registered_owner}</td>
						<td class="mono">{r.top_airport}</td>
						<td class="num">{pct(r.top_airport_share)}</td>
						<td class="num">{r.nights_observed}</td>
						<td class="num">{r.nights_in_region}</td>
						<td><span class="bar"><span style="width:{pct(r.region_share)}"></span></span>{pct(r.region_share)}</td>
						<td class="num">{r.landings_in_region}</td>
						<td>{r.last_seen}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else}
	<p class="muted">None at these thresholds.</p>
{/if}

<h2>Frequent visitors ({data.visitors.length})</h2>
<p class="muted">
	3 or more landings in the region but not based here by the rule above: usually second-home, seasonal or charter
	traffic.
</p>
{#if data.visitors.length}
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<Th k="registration" /><Th k="model" /><Th k="registered_owner" /><Th k="top_airport" />
					<Th k="nights_observed" num /><Th k="nights_in_region" num /><Th k="region_share" num />
					<Th k="landings_in_region" num /><Th k="region_airports" />
				</tr>
			</thead>
			<tbody>
				{#each data.visitors as r (r.hex)}
					<tr>
						<td><a href="/aircraft/{r.hex}">{r.registration || r.hex}</a></td>
						<td>{r.model}</td>
						<td class="wrap">{r.registered_owner}</td>
						<td class="mono">{r.top_airport ?? ''}</td>
						<td class="num">{r.nights_observed}</td>
						<td class="num">{r.nights_in_region}</td>
						<td class="num">{pct(r.region_share)}</td>
						<td class="num">{r.landings_in_region}</td>
						<td class="mono wrap">{r.region_airports}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else}
	<p class="muted">None.</p>
{/if}

<h2>In-region airports</h2>
<div class="table-wrap">
	<table>
		<thead>
			<tr>
				<th>Airport</th><th>Name</th><th>State</th>
				<th class="num" title="Likely-based aircraft whose main in-region airport is this one">Based aircraft</th>
				<th class="num" title="Different aircraft that spent at least one night here">Aircraft overnighting</th>
				<th class="num" title="Total aircraft-nights parked here">Overnights</th>
				<th class="num" title="Total arrivals here">Landings</th>
			</tr>
		</thead>
		<tbody>
			{#each data.airports as a (a.ident)}
				<tr>
					<td class="mono">{a.ident}</td>
					<td>{a.name}{a.city ? ` (${a.city})` : ''}</td>
					<td>{a.iso_region.slice(3)}</td>
					<td class="num">{a.based}</td>
					<td class="num">{a.aircraft}</td>
					<td class="num">{a.overnights}</td>
					<td class="num">{a.landings}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
