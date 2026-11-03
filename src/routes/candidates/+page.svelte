<script lang="ts">
	import { enhance } from '$app/forms';
	import { candidatesFromCsvRows, candidatesFromWords, FIELDS, normalizeCandidates, type Candidate } from '$lib/candidates';
	import { parseCsv } from '$lib/csv';

	let { data, form } = $props();

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
			if (file.name.toLowerCase().endsWith('.pdf')) {
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

<svelte:head><title>Candidate list · Regional Base Finder</title></svelte:head>

<h1>Candidate list</h1>
<p class="muted">
	{data.count} aircraft in the list{data.uploadedAt ? `, uploaded ${data.uploadedAt.slice(0, 16).replace('T', ' ')} UTC` : ''}.
	The ingest script only downloads history for these hex codes, so after replacing the list run
	<code>npm run ingest -- run</code> again.
</p>

<div class="card">
	<h2 style="margin-top:0">Replace the list</h2>
	<p class="muted">
		Upload <code>BSJC_FAA_ULR_LargeCabin_Candidate_List.pdf</code> or a CSV. Expected columns: Registration, Mode S hex,
		FAA model, Registered owner, Owner city, Owner state. Hex codes are lowercased and padded to 6 characters; rows
		without a hex are dropped. The PDF is parsed in your browser.
	</p>
	<input type="file" accept=".pdf,.csv,text/csv,application/pdf" onchange={onFile} disabled={busy} />
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
			<label>Admin token <input type="password" name="token" required autocomplete="current-password" /></label>
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
