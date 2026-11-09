<script lang="ts">
	let { data, form } = $props();
</script>

<svelte:head><title>Sign in · Regional Base Finder</title></svelte:head>

<h1>Sign in</h1>
{#if data.admin}
	<p>You are signed in. <a href="/logout">Sign out</a></p>
{:else}
	<p class="muted">Signing in lets you edit prospect status, contacts and notes, and replace the candidate list.</p>
	<form method="POST" class="inline card">
		<label>Admin token <input type="password" name="token" required autocomplete="current-password" /></label>
		<button class="primary">Sign in</button>
	</form>
	{#if form?.error}<p class="error">{form.error}</p>{/if}
{/if}
