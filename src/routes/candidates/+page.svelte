<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import {
		candidatesFromCsvRows,
		candidatesFromWords,
		cellsToStrings,
		FIELDS,
		normalizeCandidates,
		type Candidate
	} from '$lib/candidates';
	import { parseCsv } from '$lib/csv';

	let { data, form } = $props();

	// refresh status: poll while a run is in progress (or was just requested)
	const running = $derived(data.refresh?.status === 'downloading' || data.refresh?.status === 'scoring');
	onMount(() => {
		const id = setInterval(() => {
			if (running || form?.refreshRequested || form?.refreshing) invalidateAll();
		}, 15000);
		return () => clearInterval(id);
	});
	const fmtTime = (iso: string | null | undefined) =>
		iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
	const progress = $derived.by(() => {
		const r = data.refresh;
		if (!r) return 0;
		if (r.status === 'downloading') return r.days_total ? (r.days_total - r.days_pending) / r.days_total : 0;
		if (r.status === 'scoring') return r.score_total ? (r.score_total - r.score_pending) / r.score_total : 0;
		return 1;
	});

	// FAA registry upload: the zip is read in the browser; only candidate rows are sent
	let faaStatus = $state('');
	let faaError = $state('');
	let faaBusy = $state(false);
	let faaPayload = $state('');
	let faaForm = $state<HTMLFormElement | null>(null);

	async function onFaa(e: Event) {
		const files = [...((e.currentTarget as HTMLInputElement).files ?? [])];
		faaError = faaStatus = '';
		if (!files.length) return;
		faaBusy = true;
		try {
			const { readRegistry, readRegistryZip, streamSource } = await import('$lib/faa');
			const regs = new Set(data.registrations);
			const zip = files.find((f) => /\.zip$/i.test(f.name));
			const master = files.find((f) => /^master.*\.txt$/i.test(f.name));
			const dereg = files.find((f) => /^dereg.*\.txt$/i.test(f.name));
			const report = (m: string) => (faaStatus = m);
			let out;
			if (zip) out = await readRegistryZip(new Uint8Array(await zip.arrayBuffer()), regs, report);
			else if (master)
				out = await readRegistry(
					{ master: streamSource(master.stream()), dereg: dereg ? streamSource(dereg.stream()) : undefined },
					regs,
					report
				);
			else
				throw new Error(
					`Choose ReleasableAircraft.zip, or MASTER.txt (and DEREG.txt) from the unzipped folder. Got: ${files.map((f) => f.name).join(', ')}`
				);
			faaStatus =
				`Found ${out.current.length} of ${regs.size} candidates and ${out.prior.length} earlier registrations` +
				(zip || dereg ? '' : ' (DEREG.txt not chosen, so no earlier owners)') +
				'. Saving…';
			faaPayload = JSON.stringify(out);
			await tick();
			faaForm?.requestSubmit();
		} catch (err) {
			faaError = (err as Error).message;
			faaBusy = false;
		}
	}


	let parsed = $state<Candidate[] | null>(null);
	const onList = $derived(new Set(data.list.map((r) => r.hex)));
	const newCount = $derived(parsed ? parsed.filter((r) => !onList.has(r.hex)).length : 0);

	// explicit removal
	let listFilter = $state('');
	let selected = $state<Set<string>>(new Set());
	const shown = $derived.by(() => {
		const f = listFilter.trim().toLowerCase();
		return f
			? data.list.filter((r) =>
					[r.registration, r.hex, r.model, r.registered_owner, r.owner_city, r.owner_state].join(' ').toLowerCase().includes(f)
				)
			: data.list;
	});
	const allShownSelected = $derived(shown.length > 0 && shown.every((r) => selected.has(r.hex)));
	function toggle(hex: string) {
		const s = new Set(selected);
		if (s.has(hex)) s.delete(hex);
		else s.add(hex);
		selected = s;
	}
	function toggleShown() {
		const s = new Set(selected);
		if (allShownSelected) for (const r of shown) s.delete(r.hex);
		else for (const r of shown) s.add(r.hex);
		selected = s;
	}
	let info = $state('');
	let parseError = $state('');
	let busy = $state(false);
	let saving = $state(false);

	async function onFile(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		parsed = null;
		info = parseError = '';
		if (!file) return;
		busy = true;
		try {
			let raw;
			const name = file.name.toLowerCase();
			if (name.endsWith('.xlsx')) {
				const { readSheet } = await import('read-excel-file/browser');
				raw = candidatesFromCsvRows(cellsToStrings(await readSheet(file)));
			} else if (name.endsWith('.pdf')) {
				const { pdfWords } = await import('$lib/pdf');
				const pages = await pdfWords(file);
				raw = candidatesFromWords(pages);
				info = `${pages.length} PDF pages, `;
			} else {
				raw = candidatesFromCsvRows(parseCsv(await file.text()));
			}
			const { rows, dropped, duplicates } = normalizeCandidates(raw);
			if (!raw.length) throw new Error('No header row with a hex / Mode S column was found.');
			parsed = rows;
			info += `${raw.length} rows read, ${dropped} without hex dropped, ${duplicates} duplicate hex removed, ${rows.length} candidates.`;
		} catch (err) {
			parseError = (err as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Data · Regional Base Finder</title></svelte:head>

<h1>Data</h1>

<div class="card" style="margin-bottom:1rem">
	<h2 style="margin-top:0">Flight history</h2>
	<p class="muted">
		Updates automatically every night, and right after you add aircraft. Each run downloads any new days of
		ADS-B history (and history for newly added aircraft), then recalculates every score.
	</p>
	{#if data.refresh}
		{@const r = data.refresh}
		{#if r.status === 'downloading'}
			<p><strong>Downloading history:</strong> {r.days_total - r.days_pending} of {r.days_total} days ({r.trigger === 'upload' ? 'started by a list upload' : r.trigger === 'manual' ? 'started manually' : 'nightly'}, {fmtTime(r.started_at)})</p>
		{:else if r.status === 'scoring'}
			<p><strong>Recalculating scores:</strong> {r.score_total - r.score_pending} of {r.score_total} batches</p>
		{:else if r.status === 'done'}
			<p><strong>Up to date</strong> as of {fmtTime(r.finished_at)}: history {r.window_start} to {r.window_end}.</p>
		{:else}
			<p class="error">Last refresh failed ({fmtTime(r.started_at)}): {r.message}</p>
		{/if}
		{#if running}<div class="progress"><span style="width:{Math.round(progress * 100)}%"></span></div>{/if}
		{#if r.message && r.status === 'done'}<p class="muted">{r.message}</p>{/if}
	{:else}
		<p>No refresh has run yet.</p>
	{/if}
	<form method="POST" action="?/refresh" use:enhance class="inline">
		<button disabled={running}>{running ? 'Refresh running…' : 'Refresh now'}</button>
		{#if form?.refreshRequested}<span class="ok">Refresh requested; it starts within a minute.</span>{/if}
		{#if form?.refreshError}<span class="error">{form.refreshError}</span>{/if}
	</form>
</div>

<div class="card" style="margin-bottom:1rem">
	<h2 style="margin-top:0">FAA registry (owner addresses)</h2>
	<p class="muted">
		{#if data.faa?.n}
			Loaded {data.faa.loaded}: {data.faa.n} candidates with full owner address, {data.faa.prior} earlier registrations.
		{:else}
			Not loaded yet. Owner cards show only city and state until it is.
		{/if}
		Part 135 operators: {data.p135?.n ?? 0} candidates{data.p135?.loaded ? `, list of ${data.p135.loaded}` : ''}.
	</p>
	<ol class="muted">
		<li>Download <a href="https://registry.faa.gov/database/ReleasableAircraft.zip">ReleasableAircraft.zip</a> from the FAA (about 60 MB).</li>
		<li>
			Choose it below. If your browser unzipped it automatically (Safari does), open the
			<code>ReleasableAircraft</code> folder and select both <code>MASTER.txt</code> and <code>DEREG.txt</code>
			(hold ⌘ or Ctrl to pick two files).
		</li>
		<li>Your browser reads it and sends only your {data.registrations.length} candidate aircraft: a few seconds, a few MB.</li>
	</ol>
	<input type="file" multiple onchange={onFaa} disabled={faaBusy} />
	{#if faaStatus}<p>{faaStatus}</p>{/if}
	{#if faaError}<p class="error">{faaError}</p>{/if}
	<form
		method="POST"
		action="?/faa"
		bind:this={faaForm}
		use:enhance={() => async ({ update }) => {
			await update();
			faaBusy = false;
			faaPayload = '';
			faaStatus = '';
		}}
	>
		<input type="hidden" name="payload" value={faaPayload} />
	</form>
	{#if form?.faaSaved}<p class="ok">Saved {form.faaSaved} registrations and {form.faaPrior} earlier registrations.</p>{/if}
	{#if form?.faaError}<p class="error">{form.faaError}</p>{/if}
</div>

<h2>Candidate list</h2>
<p class="muted">
	{data.count} aircraft{data.uploadedAt ? `, last updated ${data.uploadedAt.slice(0, 16).replace('T', ' ')} UTC` : ''}.
	Flight history is downloaded for aircraft on this list; adding aircraft starts that automatically.
</p>

<div class="card">
	<h2 style="margin-top:0">Add aircraft</h2>
	<p class="muted">
		Upload a spreadsheet (XLSX, CSV or PDF). New aircraft are added; aircraft already on the list get their details
		updated. <strong>Nothing is removed</strong>, so a file with only the missing aircraft is fine. Expected columns:
		Registration, Mode S hex, FAA model, Registered owner, Owner city, Owner state. Rows without a hex are skipped.
	</p>
	<input type="file" accept=".xlsx,.pdf,.csv,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onchange={onFile} disabled={busy} />
	{#if busy}<p>Reading file…</p>{/if}
	{#if parseError}<p class="error">{parseError}</p>{/if}
	{#if info}<p>{info}</p>{/if}

	{#if parsed?.length}
		<p><strong>{newCount} new</strong> aircraft to add, {parsed.length - newCount} already on the list (details will be updated).</p>
		<p class="muted">Preview (first 15 rows). Check the columns line up before saving.</p>
		<div class="table-wrap">
			<table>
				<thead><tr><th></th>{#each FIELDS as f}<th>{f}</th>{/each}</tr></thead>
				<tbody>
					{#each parsed.slice(0, 15) as r}
						<tr>
							<td>{#if onList.has(r.hex)}<span class="muted">on list</span>{:else}<span class="pill good">new</span>{/if}</td>
							{#each FIELDS as f}<td class:mono={f === 'hex'}>{r[f]}</td>{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<form
			method="POST"
			action="?/add"
			class="inline"
			style="margin-top:0.75rem"
			use:enhance={() => {
				saving = true;
				return async ({ update }) => {
					await update();
					saving = false;
					parsed = null;
					info = '';
				};
			}}
		>
			<input type="hidden" name="rows" value={JSON.stringify(parsed)} />
			<button class="primary" disabled={saving}>Add {newCount} new, update {parsed.length - newCount}</button>
		</form>
	{/if}
	{#if form?.error}<p class="error">{form.error}</p>{/if}
	{#if form?.added !== undefined}
		<p class="ok">
			Added {form.added} aircraft, updated {form.updated}.{form.refreshing ? ' Downloading their flight history now; see Flight history above.' : ''}
		</p>
	{/if}
</div>

<h2>Remove aircraft</h2>
<p class="muted">
	Select aircraft and click Remove. Removed aircraft disappear from all pages; their notes are kept and come back if
	the aircraft is added again.
</p>
<div class="inline" style="margin-bottom:0.5rem; display:flex; gap:0.75rem; align-items:end; flex-wrap:wrap">
	<label>Filter <input bind:value={listFilter} placeholder="registration, owner, model…" /></label>
	<span class="muted">{shown.length} shown · {selected.size} selected</span>
	<form
		method="POST"
		action="?/remove"
		use:enhance={({ cancel }) => {
			if (!confirm(`Remove ${selected.size} aircraft from the list?`)) return cancel();
			return async ({ update }) => {
				await update();
				selected = new Set();
			};
		}}
	>
		<input type="hidden" name="hexes" value={JSON.stringify([...selected])} />
		<button disabled={!selected.size}>Remove {selected.size || ''} selected</button>
	</form>
	{#if selected.size}<button type="button" onclick={() => (selected = new Set())}>Clear selection</button>{/if}
</div>
{#if form?.removed}<p class="ok">Removed {form.removed} aircraft.</p>{/if}
{#if form?.removeError}<p class="error">{form.removeError}</p>{/if}
<div class="table-wrap list">
	<table>
		<thead>
			<tr>
				<th><input type="checkbox" checked={allShownSelected} onchange={toggleShown} aria-label="Select all shown" /></th>
				{#each FIELDS as f}<th>{f}</th>{/each}
			</tr>
		</thead>
		<tbody>
			{#each shown as r (r.hex)}
				<tr class:sel={selected.has(r.hex)}>
					<td><input type="checkbox" checked={selected.has(r.hex)} onchange={() => toggle(r.hex)} aria-label="Select {r.registration}" /></td>
					{#each FIELDS as f}<td class:mono={f === 'hex'}>{r[f]}</td>{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.progress { height: 6px; background: var(--night-none); border-radius: 3px; overflow: hidden; margin: 0.25rem 0 0.75rem; max-width: 420px; }
	.progress span { display: block; height: 100%; background: var(--accent); transition: width 0.5s; }
	.list { max-height: 70vh; overflow: auto; }
	tr.sel td { background: var(--accent-soft); }
</style>
