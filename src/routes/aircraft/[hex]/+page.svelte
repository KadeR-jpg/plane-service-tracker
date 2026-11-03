<script lang="ts">
	let { data } = $props();
	const c = $derived(data.candidate);
	const pct = (x: unknown) => `${Math.round(Number(x ?? 0) * 100)}%`;

	function addDays(d: string, n: number) {
		const [y, m, dd] = d.split('-').map(Number);
		return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
	}

	/** One cell per night of the ingest window. */
	const calendar = $derived.by(() => {
		if (!data.run) return [];
		const byNight = new Map(data.nights.map((n) => [n.night, n]));
		const out: { night: string; airport?: string; region?: boolean }[] = [];
		// first night is the evening before window_start (its 03:00 falls inside the window)
		for (let d = addDays(data.run.window_start, -1); d < data.run.window_end; d = addDays(d, 1)) {
			const n = byNight.get(d);
			out.push({ night: d, airport: n?.airport, region: n ? n.in_region === 1 : undefined });
		}
		return out;
	});

	const byAirport = $derived.by(() => {
		const m = new Map<string, { airport: string; name: string; region: boolean; nights: number; landings: number }>();
		for (const n of data.nights) {
			const e = m.get(n.airport) ?? { airport: n.airport, name: n.name ? `${n.name}${n.city ? ` (${n.city})` : ''}` : '', region: n.in_region === 1, nights: 0, landings: 0 };
			e.nights++;
			m.set(n.airport, e);
		}
		for (const l of data.landings) {
			const e = m.get(l.airport) ?? { airport: l.airport, name: l.name ? `${l.name}${l.city ? ` (${l.city})` : ''}` : '', region: l.in_region === 1, nights: 0, landings: 0 };
			e.landings++;
			m.set(l.airport, e);
		}
		return [...m.values()].sort((a, b) => b.nights - a.nights || b.landings - a.landings);
	});
	const ts = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ');
</script>

<svelte:head><title>{c.registration || c.hex} · Regional Base Finder</title></svelte:head>

<p><a href="/aircraft">← All aircraft</a></p>
<h1>{c.registration || c.hex} <span class="muted mono">{c.hex}</span></h1>
<p class="muted">
	{c.model}{c.adsb_type ? ` · ADS-B type ${c.adsb_type}` : ''}{c.adsb_registration && c.adsb_registration !== c.registration ? ` · ADS-B reg ${c.adsb_registration}` : ''}
	<br />Registered owner: {c.registered_owner || '—'}{c.owner_city || c.owner_state ? `, ${[c.owner_city, c.owner_state].filter(Boolean).join(', ')}` : ''}
</p>

{#if !c.first_seen}
	<p class="card">Not seen in the ADS-B window. Possible causes: PIA/LADD rotating hex, no flights, or no receiver coverage.</p>
{:else}
	<div class="stats">
		<div class="card stat"><div class="v">{pct(c.region_share)}</div><div class="l">Region share ({c.nights_in_region}/{c.nights_observed} nights)</div></div>
		<div class="card stat"><div class="v mono">{c.top_airport ?? '—'}</div><div class="l">Top overnight airport ({pct(c.top_airport_share)})</div></div>
		<div class="card stat"><div class="v">{c.landings_in_region}</div><div class="l">Landings in region (of {c.landings_total})</div></div>
		<div class="card stat"><div class="v" style="font-size:1rem">{c.first_seen}<br />{c.last_seen}</div><div class="l">First / last seen</div></div>
	</div>

	<h2>Overnights</h2>
	<p class="muted">
		Each square is one night (airport at 03:00 local).
		<span class="sw" style="background:var(--night-region)"></span> in region
		<span class="sw" style="background:var(--night-other)"></span> elsewhere
		<span class="sw" style="background:var(--night-none)"></span> unknown
	</p>
	<div class="cal">
		{#each calendar as n}
			<span
				class="cell"
				style="background:{n.region === undefined ? 'var(--night-none)' : n.region ? 'var(--night-region)' : 'var(--night-other)'}"
				title="{n.night}: {n.airport ?? 'unknown'}"
			></span>
		{/each}
	</div>

	<h2>By airport</h2>
	<div class="table-wrap">
		<table>
			<thead><tr><th>Airport</th><th>Name</th><th></th><th class="num">Overnights</th><th class="num">Landings</th></tr></thead>
			<tbody>
				{#each byAirport as a}
					<tr>
						<td class="mono">{a.airport}</td><td>{a.name}</td>
						<td>{#if a.region}<span class="pill good">in region</span>{/if}</td>
						<td class="num">{a.nights}</td><td class="num">{a.landings}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<h2>Landings ({data.landings.length})</h2>
	<div class="table-wrap">
		<table>
			<thead><tr><th>Time (UTC)</th><th>Airport</th><th>Name</th><th>Evidence</th></tr></thead>
			<tbody>
				{#each data.landings as l}
					<tr>
						<td class="mono">{ts(l.t)}</td>
						<td class="mono">{l.airport}</td>
						<td>{l.name}{l.city ? ` (${l.city})` : ''}</td>
						<td>{#if l.inferred}<span class="pill warn">inferred (coverage gap)</span>{:else}ground track{/if}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.cal { display: grid; grid-template-columns: repeat(auto-fill, 14px); gap: 3px; }
	.cell { width: 14px; height: 14px; border-radius: 3px; }
	.sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin: 0 3px 0 10px; vertical-align: -1px; }
</style>
