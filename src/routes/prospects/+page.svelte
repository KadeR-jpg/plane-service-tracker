<script lang="ts">
	import Th from '$lib/Th.svelte';
	import { isTrustee, STATUSES, statusLabel } from '$lib/research';
	let { data } = $props();

	let kind = $state<'all' | 'based' | 'visitor'>('all');
	let status = $state('all');
	let filter = $state('');
	const rows = $derived(
		data.rows.filter(
			(r) =>
				(kind === 'all' || r.kind === kind) &&
				(status === 'all' || r.status === status) &&
				(!filter ||
					[r.registration, r.owner, r.operator, r.top_region_airport, r.contact].join(' ').toLowerCase().includes(filter.toLowerCase()))
		)
	);
	const pct = (x: number) => `${Math.round(x * 100)}%`;
</script>

<svelte:head><title>Prospects · Regional Base Finder</title></svelte:head>

<h1>Prospects</h1>
<p class="muted">
	Likely-based aircraft (parked in region ≥ {Math.round(data.minShare * 100)}% of ≥ {data.minNights} tracked nights) and
	frequent visitors (≥ 3 in-region landings). Open an aircraft for its dossier: owner address, operator, previous owners
	and research links.
</p>

<form class="inline" style="margin: 0.75rem 0" onsubmit={(e) => e.preventDefault()}>
	<label>Type
		<select bind:value={kind}>
			<option value="all">All</option><option value="based">Likely based</option><option value="visitor">Frequent visitors</option>
		</select>
	</label>
	<label>Status
		<select bind:value={status}>
			<option value="all">All</option>
			{#each STATUSES as s}<option value={s.value}>{s.label}</option>{/each}
		</select>
	</label>
	<label>Filter <input bind:value={filter} placeholder="owner, operator, airport…" /></label>
	<span class="muted">{rows.length} of {data.rows.length}</span>
</form>

<div class="table-wrap">
	<table>
		<thead>
			<tr>
				<Th k="registration" /><th>Type</th><Th k="model" /><Th k="registered_owner" />
				<th title="FAA Part 135 charter / management certificate holder">Operator (Part 135)</th>
				<th title="Main in-region airport">Airport</th><Th k="region_share" num /><Th k="landings_in_region" num />
				<th>Status</th><th>Contact</th>
			</tr>
		</thead>
		<tbody>
			{#each rows as r (r.hex)}
				<tr>
					<td><a href="/aircraft/{r.hex}#dossier">{r.registration}</a></td>
					<td>{#if r.kind === 'based'}<span class="pill good">based</span>{:else}<span class="pill warn">visitor</span>{/if}</td>
					<td>{r.model}</td>
					<td class="wrap">{r.owner}{#if isTrustee(r.owner)} <span class="pill warn" title="Trust-owned: contact the operator">trust</span>{/if}<br /><span class="muted">{r.owner_place}</span></td>
					<td class="wrap">{r.operator || '—'}</td>
					<td class="mono">{r.top_region_airport}</td>
					<td class="num">{pct(r.region_share)}</td>
					<td class="num">{r.landings_in_region}</td>
					<td>{statusLabel(r.status)}{#if r.updated_at}<br /><span class="muted">{r.updated_at}</span>{/if}</td>
					<td class="wrap">{r.contact}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
