/**
 * Minimal streaming tar reader on plain Uint8Arrays (Node and Workers). Yields only entries
 * accepted by `want`; skipped entries are stepped over without copying. Handles ustar prefix,
 * GNU long names ('L') and pax 'path' records.
 *
 * Part-wise reading (a multi-part archive split at arbitrary 512-byte-aligned offsets):
 *  - `resync`: the stream starts mid-archive; skip 512-byte blocks until a block that is a valid
 *    ustar header (magic + checksum).
 *  - `stopAt`: stop at the first header that starts at or after this byte offset (relative to the
 *    stream start). An entry whose header is before stopAt is read to its end even past stopAt.
 */
export interface TarEntry {
	name: string;
	data: Uint8Array;
}

export interface TarOptions {
	resync?: boolean;
	stopAt?: number;
}

const dec = new TextDecoder();

function cstr(b: Uint8Array, off: number, len: number): string {
	let end = off;
	while (end < off + len && b[end] !== 0) end++;
	return dec.decode(b.subarray(off, end));
}

function octal(b: Uint8Array, off: number, len: number): number {
	if (b[off] & 0x80) {
		// GNU base-256 for large sizes
		let n = 0;
		for (let i = off + 1; i < off + len; i++) n = n * 256 + b[i];
		return n;
	}
	const s = cstr(b, off, len).trim();
	return s ? parseInt(s, 8) : 0;
}

function concat(parts: Uint8Array[], total: number): Uint8Array {
	if (parts.length === 1) return parts[0];
	const out = new Uint8Array(total);
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}

function isZeroBlock(b: Uint8Array): boolean {
	for (let i = 0; i < 512; i++) if (b[i] !== 0) return false;
	return true;
}

/** ustar magic and a matching header checksum */
export function isValidHeader(h: Uint8Array): boolean {
	if (!(h[257] === 0x75 && h[258] === 0x73 && h[259] === 0x74 && h[260] === 0x61 && h[261] === 0x72)) return false;
	let sum = 0;
	for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
	return sum === octal(h, 148, 8);
}

export async function* tarEntries(
	src: AsyncIterable<Uint8Array>,
	want: (name: string) => boolean,
	opts: TarOptions = {}
): AsyncGenerator<TarEntry> {
	let buf: Uint8Array = new Uint8Array(0);
	let pos = 0; // stream offset of buf[0]
	let skip = 0; // bytes still to discard
	let synced = !opts.resync;
	let collect: { name: string; size: number; parts: Uint8Array[]; got: number; pad: number; meta?: 'L' | 'x' } | null = null;
	let longName: string | null = null;

	const advance = (n: number) => {
		buf = buf.subarray(n);
		pos += n;
	};

	for await (const chunk of src) {
		if (buf.length) {
			const b = new Uint8Array(buf.length + chunk.length);
			b.set(buf);
			b.set(chunk, buf.length);
			buf = b;
		} else buf = chunk;
		while (true) {
			if (skip) {
				const n = Math.min(skip, buf.length);
				advance(n);
				skip -= n;
				if (skip) break;
			}
			if (collect) {
				const n = Math.min(collect.size - collect.got, buf.length);
				if (n) {
					collect.parts.push(buf.slice(0, n));
					collect.got += n;
					advance(n);
				}
				if (collect.got < collect.size) break;
				const done = collect;
				collect = null;
				skip = done.pad;
				const data = concat(done.parts, done.size);
				if (done.meta === 'L') longName = cstr(data, 0, data.length);
				else if (done.meta === 'x') {
					const m = /\d+ path=([^\n]*)\n/.exec(dec.decode(data));
					if (m) longName = m[1];
				} else yield { name: done.name, data };
				continue;
			}
			if (buf.length < 512) break;
			if (opts.stopAt !== undefined && pos >= opts.stopAt) return;
			const h = buf.subarray(0, 512);
			if (!synced) {
				if (!isValidHeader(h)) {
					advance(512);
					continue;
				}
				synced = true;
			}
			advance(512);
			if (isZeroBlock(h)) continue; // end-of-archive / padding
			const size = octal(h, 124, 12);
			const type = String.fromCharCode(h[156] || 48);
			const pad = (512 - (size % 512)) % 512;
			const prefix = cstr(h, 257, 6).startsWith('ustar') ? cstr(h, 345, 155) : '';
			const name = longName ?? (prefix ? `${prefix}/${cstr(h, 0, 100)}` : cstr(h, 0, 100));
			if (type === 'L' || type === 'x') {
				collect = { name, size, parts: [], got: 0, pad, meta: type };
				continue;
			}
			longName = null;
			if ((type === '0' || type === '\0') && want(name)) collect = { name, size, parts: [], got: 0, pad };
			else skip = size + pad;
		}
	}
}
