<script lang="ts">
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

<div class="stats">
	<div class="card stat"><div class="v">{data.totals.candidates}</div><div class="l">Candidates</div></div>
	<div class="card stat"><div class="v">{data.totals.seen}</div><div class="l">Seen in ADS-B window</div></div>
	<div class="card stat"><div class="v">{data.totals.active}</div><div class="l">Any in-region activity</div></div>
	<div class="card stat"><div class="v">{data.totals.based}</div><div class="l">Likely based</div></div>
</div>

<form class="inline card" method="GET">
	<label>Min region share <input name="minShare" type="number" step="0.05" min="0" max="1" value={data.minShare} /></label>
	<label>Min nights observed <input name="minNights" type="number" step="1" min="0" value={data.minNights} /></label>
	<button type="submit">Apply</button>
	<span class="muted" style="margin-left:auto">
		Export:
		<a href="/export/regional_base_candidates.csv">regional_base_candidates.csv</a> ·
		<a href="/export/overnights.csv">overnights.csv</a> ·
		<a href="/export/summary.md?{q}">summary.md</a>
	</span>
</form>

<h2>Likely based ({data.based.length})</h2>
<p class="muted">region_share ≥ {data.minShare} and nights_observed ≥ {data.minNights}</p>
{#if data.based.length}
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>Registration</th><th>Model</th><th>Registered owner</th><th>Top airport</th>
					<th class="num">Top share</th><th class="num">Nights</th><th class="num">In region</th>
					<th>Region share</th><th class="num">Landings in region</th><th>Last seen</th>
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
<p class="muted">≥ 3 in-region landings, not classed as based: second-home, seasonal or charter traffic.</p>
{#if data.visitors.length}
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>Registration</th><th>Model</th><th>Registered owner</th><th>Top airport</th>
					<th class="num">Nights</th><th class="num">In region</th><th class="num">Region share</th>
					<th class="num">Landings in region</th><th>In-region airports (nights/landings)</th>
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
				<th>Airport</th><th>Name</th><th>State</th><th class="num">Likely-based aircraft</th>
				<th class="num">Distinct aircraft overnighting</th><th class="num">Overnights</th><th class="num">Landings</th>
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
