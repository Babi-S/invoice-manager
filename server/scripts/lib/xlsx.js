// Minimal, dependency-free .xlsx reader: enough to read cell values by sheet.
import { inflateRawSync } from 'node:zlib';

function readZip(buf) {
  const sig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const eocd = buf.lastIndexOf(sig);
  if (eocd < 0) throw new Error('Not a valid .xlsx (zip) file');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28);
    const elen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nlen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    files.set(name, method === 0 ? data : inflateRawSync(data));
    off += 46 + nlen + elen + clen;
  }
  return files;
}

const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const textOf = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('');

const colIndex = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

/** Returns [{ name, rows: Array<Array<string|number|null>> }] */
export function readWorkbook(buffer) {
  const files = readZip(buffer);
  const read = (p) => files.get(p)?.toString('utf8') ?? '';

  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const rels = new Map(
    [...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
      /Id="([^"]+)"/.exec(m[0])[1],
      /Target="([^"]+)"/.exec(m[0])[1],
    ]),
  );

  return [...read('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)].map((m) => {
    const name = decode(/name="([^"]+)"/.exec(m[0])[1]);
    const target = rels.get(/r:id="([^"]+)"/.exec(m[0])[1]).replace(/^\/?(xl\/)?/, '');
    const rows = [];
    for (const row of read(`xl/${target}`).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
        const type = /t="([^"]+)"/.exec(attrs)?.[1];
        const inner = c[2] || '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let value = null;
        if (type === 's' && v != null) value = shared[Number(v)];
        else if (type === 'inlineStr') value = textOf(inner);
        else if (type === 'str' && v != null) value = decode(v);
        else if (v != null) value = Number.isFinite(Number(v)) ? Number(v) : decode(v);
        if (ref) cells[colIndex(ref)] = value;
      }
      rows.push(Array.from(cells, (x) => (x === undefined ? null : x)));
    }
    return { name, rows };
  });
}

/** Excel serial date → UTC Date */
export const excelDate = (serial) => new Date(Math.round((serial - 25569) * 86_400_000));
