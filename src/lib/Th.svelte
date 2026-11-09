<script lang="ts">
	import { TERMS, type TermKey } from './glossary';
	let { k, num = false, children }: { k: TermKey; num?: boolean; children?: import('svelte').Snippet } = $props();
</script>

<th class:num title={TERMS[k].help}><span class="term">{#if children}{@render children()}{:else}{TERMS[k].label}{/if}</span></th>
