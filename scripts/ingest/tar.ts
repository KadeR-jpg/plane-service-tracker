/**
 * Minimal streaming tar reader. Yields only entries accepted by `want`; skipped entries are
 * stepped over without copying. Handles ustar prefix, GNU long names ('L') and pax 'path'.
 */
export interface TarEntry {
	name: string;
	data: Buffer;
}

function str(b: Buffer, off: number, len: number): string {
	const end = b.indexOf(0, off);
	return b.toString('utf8', off, end === -1 || end > off + len ? off + len : end);
}

function octal(b: Buffer, off: number, len: number): number {
	if (b[off] & 0x80) {
		// base-256 (GNU) for large sizes
		let n = 0;
		for (let i = off + 1; i < off + len; i++) n = n * 256 + b[i];
		return n;
	}
	const s = str(b, off, len).trim();
	return s ? parseInt(s, 8) : 0;
}

export async function* tarEntries(
	src: AsyncIterable<Uint8Array>,
	want: (name: string) => boolean
): AsyncGenerator<TarEntry> {
	let buf: Buffer = Buffer.alloc(0);
	let skip = 0; // bytes still to discard
	let collect: { name: string; size: number; parts: Buffer[]; got: number; pad: number } | null = null;
	let longName: string | null = null;
	let meta: { kind: 'L' | 'x'; size: number; parts: Buffer[]; got: number; pad: number } | null = null;

	for await (const chunk of src) {
		buf = buf.length ? Buffer.concat([buf, Buffer.from(chunk)]) : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
		while (true) {
			if (skip) {
				const n = Math.min(skip, buf.length);
				buf = buf.subarray(n);
				skip -= n;
				if (skip) break;
			}
			if (collect) {
				const need = collect.size - collect.got;
				const n = Math.min(need, buf.length);
				if (n) {
					collect.parts.push(Buffer.from(buf.subarray(0, n)));
					collect.got += n;
					buf = buf.subarray(n);
				}
				if (collect.got < collect.size) break;
				const done = collect;
				collect = null;
				skip = done.pad;
				yield { name: done.name, data: Buffer.concat(done.parts) };
				continue;
			}
			if (meta) {
				const need = meta.size - meta.got;
				const n = Math.min(need, buf.length);
				if (n) {
					meta.parts.push(Buffer.from(buf.subarray(0, n)));
					meta.got += n;
					buf = buf.subarray(n);
				}
				if (meta.got < meta.size) break;
				const body = Buffer.concat(meta.parts);
				if (meta.kind === 'L') longName = str(body, 0, body.length);
				else {
					const m = /\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
					if (m) longName = m[1];
				}
				skip = meta.pad;
				meta = null;
				continue;
			}
			if (buf.length < 512) break;
			const h = buf.subarray(0, 512);
			buf = buf.subarray(512);
			if (h.every((x) => x === 0)) continue; // end-of-archive / padding blocks
			const size = octal(h, 124, 12);
			const type = String.fromCharCode(h[156] || 48);
			const pad = (512 - (size % 512)) % 512;
			const prefix = h.toString('utf8', 257, 263).startsWith('ustar') ? str(h, 345, 155) : '';
			const name = longName ?? (prefix ? `${prefix}/${str(h, 0, 100)}` : str(h, 0, 100));
			if (type === 'L' || type === 'x') {
				meta = { kind: type, size, parts: [], got: 0, pad };
				continue;
			}
			longName = null;
			if ((type === '0' || type === '\0') && want(name)) collect = { name, size, parts: [], got: 0, pad };
			else skip = size + pad;
		}
	}
}
