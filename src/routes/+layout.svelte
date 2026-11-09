<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	let { children, data } = $props();
	const links = [
		{ href: '/', label: 'Summary' },
		{ href: '/aircraft', label: 'All aircraft' },
		{ href: '/prospects', label: 'Prospects' },
		{ href: '/candidates', label: 'Data' }
	];
</script>

<header>
	<div class="inner">
		<a class="brand" href="/">Regional Base Finder</a>
		{#if data.user}
		<nav>
			{#each links as l}
				<a href={l.href} class:active={l.href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(l.href)}>{l.label}</a>
			{/each}
		</nav>
		{/if}
		<span class="auth">
			{#if data.user}<a href="/account">{data.user.name || data.user.email}</a> · <a href="/logout">Sign out</a>{/if}
		</span>
	</div>
</header>

<main>
	{@render children()}
</main>

<style>
	header { background: var(--surface); border-bottom: 1px solid var(--border); }
	.inner { max-width: 1280px; margin: 0 auto; padding: 0.6rem 16px; display: flex; flex-wrap: wrap; gap: 0.5rem 1.5rem; align-items: center; }
	.brand { font-weight: 700; color: var(--text); }
	nav { display: flex; gap: 1rem; flex-wrap: wrap; }
	nav a { color: var(--muted); }
	nav a.active { color: var(--accent); font-weight: 600; }
	.auth { margin-left: auto; font-size: 13px; }
</style>
