<script lang="ts">
	let { form } = $props();
</script>

<svelte:head><title>Sign in · Regional Base Finder</title></svelte:head>

<div class="auth-box card">
	<h1>Sign in</h1>
	<form method="POST" class="stack">
		<label>Email <input type="email" name="email" required autocomplete="username" defaultValue={form?.email ?? ''} /></label>
		<label>Password <input type="password" name="password" required autocomplete="current-password" /></label>
		<button class="primary">Sign in</button>
		{#if form?.error}<p class="error">{form.error}</p>{/if}
	</form>
	<p class="muted">No account? Ask someone who has one to add you from their Account page.</p>
</div>
