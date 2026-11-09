<script lang="ts">
	import { enhance } from '$app/forms';
	import { aircraftLinks, entityLinks, isLlc, isTrustee, peopleLinks, STATUSES, statusLabel, type Link } from './research';

	type Row = Record<string, string | number | null>;
	type Fleet = { hex: string; registration: string; model: string; top_airport: string | null; region_share: number | null };
	let {
		candidate,
		registry,
		prior,
		operator,
		callsigns,
		prospect,
		sameOwner,
		sameOperator,
		admin,
		form
	}: {
		candidate: Row;
		registry: Record<string, string> | null;
		prior: Record<string, string>[];
		operator: Record<string, string> | null;
		callsigns: { callsign: string; days: number; last_day: string }[];
		prospect: Record<string, string> | null;
		sameOwner: Fleet[];
		sameOperator: Fleet[];
		admin: boolean;
		form: { saved?: boolean; error?: string } | null | undefined;
	} = $props();

	const owner = $derived(String(registry?.name || candidate.registered_owner || ''));
	const ownerState = $derived(String(registry?.state || candidate.owner_state || ''));
	const trustee = $derived(isTrustee(owner));
	const reg = $derived(String(candidate.registration || ''));
	const opName = $derived(operator?.operator ?? '');

	const groups = $derived.by(() => {
		const g: { title: string; links: Link[] }[] = [
			{ title: 'Aircraft', links: aircraftLinks(reg, String(candidate.hex), registry?.serial ?? '') }
		];
		if (opName) g.push({ title: `Operator: ${opName}`, links: [...entityLinks(opName, ''), ...peopleLinks(opName)] });
		if (owner && !trustee)
			g.push({ title: `Owner: ${owner}`, links: [...entityLinks(owner, ownerState), ...(isLlc(owner) ? [] : peopleLinks(owner))] });
		for (const co of (registry?.other_names ?? '').split('; ').filter(Boolean))
			g.push({ title: `Co-owner: ${co}`, links: entityLinks(co, ownerState) });
		return g;
	});
	const address = $derived(
		registry
			? [registry.street, registry.street2, [registry.city, registry.state, registry.zip?.replace(/^(\d{5})(\d{4})$/, '$1-$2')].filter(Boolean).join(' '), registry.country !== 'US' ? registry.country : '']
					.filter(Boolean)
			: []
	);
	const pct = (x: number | null) => (x == null ? '' : `${Math.round(x * 100)}%`);
	const nCallsign = (c: string) => /^N[0-9]/.test(c);
</script>

<h2>Prospect dossier</h2>

{#if trustee}
	<p class="card banner">
		<strong>Trust-owned.</strong> {owner} is a trustee; the beneficial owner is not public. Reach the aircraft through its
		{opName ? `operator (${opName})` : 'operator or management company'}, the FBO at its home airport, or the
		{prior.length ? 'previous owners below' : 'FAA registry co-owner names'}.
	</p>
{/if}

<div class="grid">
	<section class="card">
		<h3>Status and contacts</h3>
		{#if admin}
			<form method="POST" action="?/prospect" use:enhance={() => async ({ update }) => update({ reset: false })} class="stack">
				<label>Status
					<select name="status" value={prospect?.status ?? 'new'}>
						{#each STATUSES as s}<option value={s.value}>{s.label}</option>{/each}
					</select>
				</label>
				<label>Contact name <input name="contact_name" value={prospect?.contact_name ?? ''} /></label>
				<label>Role <input name="contact_role" value={prospect?.contact_role ?? ''} placeholder="Director of aviation, chief pilot…" /></label>
				<label>Phone <input name="contact_phone" value={prospect?.contact_phone ?? ''} /></label>
				<label>Email <input name="contact_email" type="email" value={prospect?.contact_email ?? ''} /></label>
				<label>Notes <textarea name="notes" rows="4">{prospect?.notes ?? ''}</textarea></label>
				<div><button class="primary">Save</button>
					{#if form?.saved}<span class="ok"> Saved.</span>{/if}
					{#if form?.error}<span class="error"> {form.error}</span>{/if}
					{#if prospect?.updated_at}<span class="muted"> Last updated {prospect.updated_at.slice(0, 10)}</span>{/if}
				</div>
			</form>
		{:else}
			<p><strong>{statusLabel(prospect?.status)}</strong></p>
			{#if prospect?.contact_name}<p>{prospect.contact_name}{prospect.contact_role ? `, ${prospect.contact_role}` : ''}</p>{/if}
			{#if prospect?.notes}<p class="pre">{prospect.notes}</p>{/if}
			<p class="muted"><a href="/login">Sign in</a> to edit status, contacts and notes.</p>
		{/if}
	</section>

	<section class="card">
		<h3>Registered owner (FAA)</h3>
		<p><strong>{owner || '—'}</strong>{registry?.registrant_type ? ` · ${registry.registrant_type}` : ''}</p>
		{#if address.length}
			<p>{#each address as line}{line}<br />{/each}</p>
		{:else}
			<p>{[candidate.owner_city, candidate.owner_state].filter(Boolean).join(', ')}</p>
			<p class="muted">Street address appears once the FAA registry file is loaded.</p>
		{/if}
		{#if registry?.other_names}<p>Co-owners: {registry.other_names}</p>{/if}
		{#if registry}
			<p class="muted">
				Registered {registry.cert_issue_date || '?'} · expires {registry.expiration_date || '?'}
				{registry.year_mfr ? ` · built ${registry.year_mfr}` : ''}{registry.serial ? ` · s/n ${registry.serial}` : ''}
				{registry.fract_owner?.trim() ? ' · fractional ownership' : ''}
			</p>
		{/if}
	</section>

	<section class="card">
		<h3>Operator</h3>
		{#if operator}
			<p><strong>{operator.operator}</strong></p>
			<p class="muted">
				FAA Part 135 certificate {operator.designator} · district office {operator.chdo} · list of {operator.list_date}
			</p>
			<p>Charter or management company that flies this aircraft: usually the best first contact.</p>
		{:else}
			<p>Not on any FAA Part 135 (charter) certificate.</p>
			<p class="muted">Likely flown privately under Part 91 by the owner's own flight department or a non-charter manager.</p>
		{/if}
		{#if callsigns.length}
			<p>Callsigns flown:
				{#each callsigns as c, i}{i ? ', ' : ''}<span class="mono">{c.callsign}</span> <span class="muted">({c.days} d)</span>{/each}
			</p>
			{#if callsigns.some((c) => !nCallsign(c.callsign))}
				<p class="muted">Callsigns that are not the N-number start with the operator's 3-letter ICAO code.</p>
			{/if}
		{/if}
	</section>
</div>

{#if prior.length}
	<h3>Previous registrations of this airframe</h3>
	<div class="table-wrap">
		<table>
			<thead><tr><th>N-number</th><th>Owner</th><th>Address</th><th>Registered</th><th>Cancelled</th></tr></thead>
			<tbody>
				{#each prior as p}
					<tr>
						<td class="mono">{p.prior_registration}</td><td class="wrap">{p.name}</td>
						<td class="wrap">{[p.street, p.city, p.state, p.zip].filter(Boolean).join(', ')}</td>
						<td>{p.cert_issue_date}</td><td>{p.cancel_date}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

{#each [{ title: `Same registered owner`, rows: sameOwner }, { title: `Same operator${opName ? ` (${opName})` : ''}`, rows: sameOperator }] as f}
	{#if f.rows.length}
		<details class="fleet" open={f.rows.length <= 8}>
			<summary>{f.title}: {f.rows.length} other candidate{f.rows.length === 1 ? '' : 's'}</summary>
			<div class="table-wrap">
				<table>
					<thead><tr><th>Registration</th><th>Model</th><th>Top overnight airport</th><th class="num">Region share</th></tr></thead>
					<tbody>
						{#each f.rows as r}
							<tr>
								<td><a href="/aircraft/{r.hex}#dossier">{r.registration}</a></td><td>{r.model}</td>
								<td class="mono">{r.top_airport ?? ''}</td><td class="num">{pct(r.region_share)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</details>
	{/if}
{/each}

<h3>Research links</h3>
<p class="muted">Open in a new tab. LinkedIn, ZoomInfo-style contact data and the state sites can't be queried automatically; these take you straight to the right search.</p>
<div class="grid">
	{#each groups as g}
		<section class="card">
			<h4>{g.title}</h4>
			<ul>
				{#each g.links as l}
					<li><a href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>{#if l.note}<span class="muted">&nbsp;· {l.note}</span>{/if}</li>
				{/each}
			</ul>
		</section>
	{/each}
</div>

<style>
	.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0.75rem; }
	h3 { font-size: 1rem; margin: 1.25rem 0 0.5rem; }
	section h3, section h4 { margin: 0 0 0.5rem; font-size: 0.95rem; }
	section p { margin: 0.35rem 0; }
	.banner { border-color: var(--warn); background: var(--warn-soft); margin-bottom: 0.75rem; }
	.stack { display: grid; gap: 0.5rem; }
	.stack input, .stack select, .stack textarea { width: 100%; font: inherit; }
	textarea { color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 5px 8px; }
	ul { margin: 0; padding-left: 1.1rem; }
	li { margin: 0.2rem 0; }
	.pre { white-space: pre-wrap; }
	.fleet { margin: 1rem 0; }
	.fleet summary { cursor: pointer; font-weight: 600; margin-bottom: 0.5rem; }
</style>
