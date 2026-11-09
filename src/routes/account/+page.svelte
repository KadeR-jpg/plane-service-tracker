<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props();
</script>

<svelte:head><title>Account · Regional Base Finder</title></svelte:head>

<h1>Account</h1>
<p class="muted">Signed in as {data.user?.name ? `${data.user.name} (${data.user.email})` : data.user?.email}.</p>

<div class="cols">
	<section class="card">
		<h2>Change password</h2>
		<form method="POST" action="?/password" class="stack" use:enhance>
			<label>Current password <input type="password" name="current" required autocomplete="current-password" /></label>
			<label>New password (10+ characters) <input type="password" name="password" required minlength="10" autocomplete="new-password" /></label>
			<label>Confirm new password <input type="password" name="confirm" required minlength="10" autocomplete="new-password" /></label>
			<button class="primary">Change password</button>
			{#if form?.pwError}<p class="error">{form.pwError}</p>{/if}
			{#if form?.pwSaved}<p class="ok">Password changed. Other devices were signed out.</p>{/if}
		</form>
	</section>

	<section class="card">
		<h2>Add a user</h2>
		<p class="muted">Set a starting password and send it to them; they can change it here after signing in.</p>
		<form method="POST" action="?/add" class="stack" use:enhance>
			<label>Name <input name="name" value={form?.name ?? ''} /></label>
			<label>Email <input type="email" name="email" required value={form?.email ?? ''} /></label>
			<label>Starting password (10+ characters) <input type="text" name="password" required minlength="10" autocomplete="off" /></label>
			<button class="primary">Add user</button>
			{#if form?.addError}<p class="error">{form.addError}</p>{/if}
			{#if form?.added}<p class="ok">Added {form.added}.</p>{/if}
		</form>
	</section>
</div>

<h2>Users ({data.users.length})</h2>
<div class="table-wrap">
	<table>
		<thead><tr><th>Name</th><th>Email</th><th>Added</th><th></th></tr></thead>
		<tbody>
			{#each data.users as u (u.id)}
				<tr>
					<td>{u.name}</td><td>{u.email}</td><td>{u.created_at.slice(0, 10)}</td>
					<td>
						{#if u.id !== data.user?.id}
							<form method="POST" action="?/remove" use:enhance
								onsubmit={(e) => { if (!confirm(`Remove ${u.email}?`)) e.preventDefault(); }}>
								<input type="hidden" name="id" value={u.id} /><button>Remove</button>
							</form>
						{:else}<span class="muted">you</span>{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
{#if form?.removeError}<p class="error">{form.removeError}</p>{/if}

<style>
	.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 0.75rem; margin-top: 1rem; }
	section h2 { margin-top: 0; }
</style>
