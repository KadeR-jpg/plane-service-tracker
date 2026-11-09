<script lang="ts">
	import { GLOSSARY_ORDER, TERMS } from './glossary';
	let { open = false }: { open?: boolean } = $props();
</script>

<details class="glossary card" {open}>
	<summary>What the columns mean</summary>
	<p class="muted">
		Each night, the aircraft's location is taken at 3 AM local time. A night only counts when we can tell where it
		was parked. Hover a column header for its definition.
	</p>
	<dl>
		{#each GLOSSARY_ORDER as k}
			<dt>{TERMS[k].label}</dt>
			<dd>{TERMS[k].help}</dd>
		{/each}
	</dl>
	<p class="muted">
		Example: 90 nights tracked, 72 nights in region → region share 80%. An aircraft with 40 landings in region but a
		10% region share flies in often but sleeps elsewhere.
	</p>
</details>

<style>
	.glossary { margin: 1rem 0; }
	summary { cursor: pointer; font-weight: 600; }
	dl { display: grid; grid-template-columns: minmax(9rem, max-content) 1fr; gap: 0.35rem 1rem; margin: 0.75rem 0; }
	dt { font-weight: 600; }
	dd { margin: 0; color: var(--muted); }
	@media (max-width: 560px) {
		dl { grid-template-columns: 1fr; }
		dd { margin-bottom: 0.4rem; }
	}
</style>
