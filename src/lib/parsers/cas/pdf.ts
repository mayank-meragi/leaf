// Password-protected PDF → text lines, using pdf.js in the browser.
// pdf.js gives positioned text fragments; we rebuild visual lines by grouping on the y coordinate.

import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export class WrongPasswordError extends Error {}

interface Fragment {
  str: string;
  x: number;
  y: number;
  width: number;
}

export async function pdfToLines(data: Uint8Array, password?: string): Promise<string[]> {
  // pdf.js transfers (detaches) the buffer it's given, so hand it a copy.
  const task = pdfjs.getDocument({ data: data.slice(), password });
  let doc: pdfjs.PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (e) {
    if ((e as Error).name === "PasswordException") throw new WrongPasswordError("CAS password is missing or wrong");
    throw e;
  }

  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const frags: Fragment[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      frags.push({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width });
    }
    // Top-to-bottom, then left-to-right; fragments within 2pt vertically share a line.
    frags.sort((a, b) => b.y - a.y || a.x - b.x);
    let row: Fragment[] = [];
    const flush = () => {
      if (!row.length) return;
      row.sort((a, b) => a.x - b.x);
      let text = row[0].str;
      for (let i = 1; i < row.length; i++) {
        const gap = row[i].x - (row[i - 1].x + row[i - 1].width);
        // A wide gap means a column boundary; keep it visible as a double space.
        text += (gap > 8 ? "  " : gap > 0.5 ? " " : "") + row[i].str;
      }
      lines.push(text.replace(/\s+$/, ""));
      row = [];
    };
    for (const f of frags) {
      if (row.length && Math.abs(row[0].y - f.y) > 2) flush();
      row.push(f);
    }
    flush();
  }
  await task.destroy();
  return lines;
}
