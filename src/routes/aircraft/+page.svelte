<script lang="ts">
	import Glossary from '$lib/Glossary.svelte';
	import { TERMS } from '$lib/glossary';
	import type { ResultRow } from '$lib/server/db';
	let { data } = $props();

	type Key = keyof ResultRow;
	let filter = $state('');
	let onlySeen = $state(true);
	let sortKey = $state<Key>('region_share');
	let desc = $state(true);

	const numeric = new Set<Key>(['top_airport_share', 'nights_observed', 'nights_in_region', 'region_share', 'landings_in_region']);
	const cols = (
		[
			'registration', 'hex', 'model', 'registered_owner', 'owner_city_state', 'top_airport', 'top_airport_share',
			'nights_observed', 'nights_in_region', 'region_share', 'landings_in_region', 'first_seen', 'last_seen'
		] as const
	).map((k) => ({ k, label: TERMS[k].label, help: TERMS[k].help, num: numeric.has(k) }));

	const rows = $derived.by(() => {
		const f = filter.trim().toLowerCase();
		const out = data.rows.filter(
			(r) =>
				(!onlySeen || r.first_seen) &&
				(!f ||
					[r.registration, r.hex, r.model, r.registered_owner, r.owner_city_state, r.top_airport]
						.join(' ')
						.toLowerCase()
						.includes(f))
		);
		const k = sortKey;
		return out.sort((a, b) => {
			const x = a[k] ?? '',
				y = b[k] ?? '';
			const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
			return desc ? -c : c;
		});
	});

	function sortBy(k: Key) {
		if (sortKey === k) desc = !desc;
		else {
			sortKey = k;
			desc = typeof data.rows[0]?.[k] === 'number';
		}
	}
	const fmt = (k: Key, v: unknown) =>
		v == null ? '' : k.endsWith('share') ? `${Math.round((v as number) * 100)}%` : String(v);
</script>

<svelte:head><title>All aircraft · Regional Base Finder</title></svelte:head>

<h1>All candidates</h1>
<Glossary />
<form class="inline" style="margin: 0.75rem 0" onsubmit={(e) => e.preventDefault()}>
	<label>Filter <input bind:value={filter} placeholder="registration, owner, airport…" /></label>
	<label style="display:flex;gap:6px;align-items:center;color:var(--text)">
		<input type="checkbox" bind:checked={onlySeen} /> Seen in ADS-B only
	</label>
	<span class="muted">{rows.length} of {data.rows.length}</span>
</form>

<div class="table-wrap">
	<table>
		<thead>
			<tr>
				{#each cols as c}
					<th class:num={c.num} title={c.help}>
						<a href="#sort" onclick={(e) => { e.preventDefault(); sortBy(c.k); }}>
							{c.label}{sortKey === c.k ? (desc ? ' ↓' : ' ↑') : ''}
						</a>
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each rows as r (r.hex)}
				<tr>
					{#each cols as c}
						<td class:num={c.num} class:mono={c.k === 'hex' || c.k === 'top_airport'}>
							{#if c.k === 'registration'}
								<a href="/aircraft/{r.hex}">{r.registration || '—'}</a>{#if r.partial} <span class="pill warn" title="Partial results while the refresh is running">partial</span>{/if}
							{:else}
								{fmt(c.k, r[c.k])}
							{/if}
						</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>
