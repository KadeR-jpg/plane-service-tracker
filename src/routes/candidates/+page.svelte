<script lang="ts">
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';
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
	{data.count} aircraft in the list{data.uploadedAt ? `, uploaded ${data.uploadedAt.slice(0, 16).replace('T', ' ')} UTC` : ''}.
	The ingest script only downloads history for these hex codes, so after replacing the list run
	<code>npm run ingest -- run</code> again.
</p>

<div class="card">
	<h2 style="margin-top:0">Replace the list</h2>
	<p class="muted">
		Upload the BSJC candidate list as XLSX, PDF or CSV (first sheet of a workbook). Expected columns: Registration, Mode S hex,
		FAA model, Registered owner, Owner city, Owner state. Hex codes are lowercased and padded to 6 characters; rows
		without a hex are dropped. The file is parsed in your browser.
	</p>
	<input type="file" accept=".xlsx,.pdf,.csv,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onchange={onFile} disabled={busy} />
	{#if busy}<p>Parsing…</p>{/if}
	{#if parseError}<p class="error">{parseError}</p>{/if}
	{#if info}<p>{info}</p>{/if}

	{#if parsed?.length}
		<p class="muted">Preview (first 15 rows). Check the columns line up before saving.</p>
		<div class="table-wrap">
			<table>
				<thead><tr>{#each FIELDS as f}<th>{f}</th>{/each}</tr></thead>
				<tbody>
					{#each parsed.slice(0, 15) as r}
						<tr>{#each FIELDS as f}<td class:mono={f === 'hex'}>{r[f]}</td>{/each}</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<form
			method="POST"
			action="?/save"
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
			<button class="primary" disabled={saving}>Replace list with {parsed.length} aircraft</button>
		</form>
	{/if}
	{#if form?.error}<p class="error">{form.error}</p>{/if}
	{#if form?.saved}<p class="ok">Saved {form.saved} candidates.</p>{/if}
</div>

{#if data.sample.length}
	<h2>Current list (first 25 by registration)</h2>
	<div class="table-wrap">
		<table>
			<thead><tr>{#each FIELDS as f}<th>{f}</th>{/each}</tr></thead>
			<tbody>
				{#each data.sample as r}
					<tr>{#each FIELDS as f}<td class:mono={f === 'hex'}>{r[f]}</td>{/each}</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
