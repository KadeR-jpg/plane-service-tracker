<script lang="ts">
	let { form } = $props();
</script>

<svelte:head><title>Create account · Regional Base Finder</title></svelte:head>

<div class="auth-box card">
	<h1>Create your account</h1>
	<p class="muted">No accounts exist yet. This first account can add others later from the Account page.</p>
	<form method="POST" class="stack">
		<label>Name <input name="name" autocomplete="name" defaultValue={form?.name ?? ''} /></label>
		<label>Email <input type="email" name="email" required autocomplete="username" defaultValue={form?.email ?? ''} /></label>
		<label>Password (10+ characters) <input type="password" name="password" required minlength="10" autocomplete="new-password" /></label>
		<label>Confirm password <input type="password" name="confirm" required minlength="10" autocomplete="new-password" /></label>
		<button class="primary">Create account</button>
		{#if form?.error}<p class="error">{form.error}</p>{/if}
	</form>
</div>
