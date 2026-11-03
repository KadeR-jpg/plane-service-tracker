/** Browser-only: positioned text words from each PDF page via pdf.js. */
import type { Word } from './candidates';

export async function pdfWords(file: File): Promise<Word[][]> {
	const pdfjs = await import('pdfjs-dist');
	const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
	pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
	const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
	const pages: Word[][] = [];
	for (let i = 1; i <= doc.numPages; i++) {
		const page = await doc.getPage(i);
		const vp = page.getViewport({ scale: 1 });
		const tc = await page.getTextContent();
		const words: Word[] = [];
		for (const it of tc.items) {
			if (!('str' in it) || !it.str.trim()) continue;
			const x = it.transform[4];
			const y = it.transform[5];
			words.push({ text: it.str.trim(), x0: x, x1: x + it.width, top: vp.height - y });
		}
		pages.push(words);
	}
	return pages;
}
