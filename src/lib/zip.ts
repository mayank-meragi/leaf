// Minimal ZIP writer (stored, no compression): the export is a handful of text files, so a dependency isn't worth it.

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files: { name: string; content: string }[], now = new Date()): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const entries = files.map((f) => {
    const name = enc.encode(f.name);
    const data = enc.encode(f.content);
    return { name, data, crc: crc32(data) };
  });

  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const header = (size: number, sig: number, fields: (v: DataView) => void) => {
    const buf = new Uint8Array(size);
    const v = new DataView(buf.buffer);
    v.setUint32(0, sig, true);
    fields(v);
    return buf;
  };
  for (const e of entries) {
    // General purpose flag bit 11: names are UTF-8.
    const local = header(30, 0x04034b50, (v) => {
      v.setUint16(4, 20, true);
      v.setUint16(6, 0x0800, true);
      v.setUint16(10, time, true);
      v.setUint16(12, date, true);
      v.setUint32(14, e.crc, true);
      v.setUint32(18, e.data.length, true);
      v.setUint32(22, e.data.length, true);
      v.setUint16(26, e.name.length, true);
    });
    central.push(
      header(46, 0x02014b50, (v) => {
        v.setUint16(4, 20, true);
        v.setUint16(6, 20, true);
        v.setUint16(8, 0x0800, true);
        v.setUint16(12, time, true);
        v.setUint16(14, date, true);
        v.setUint32(16, e.crc, true);
        v.setUint32(20, e.data.length, true);
        v.setUint32(24, e.data.length, true);
        v.setUint16(28, e.name.length, true);
        v.setUint32(42, offset, true);
      }),
      e.name,
    );
    parts.push(local, e.name, e.data);
    offset += local.length + e.name.length + e.data.length;
  }
  const centralSize = central.reduce((s, p) => s + p.length, 0);
  const end = header(22, 0x06054b50, (v) => {
    v.setUint16(8, entries.length, true);
    v.setUint16(10, entries.length, true);
    v.setUint32(12, centralSize, true);
    v.setUint32(16, offset, true);
  });
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
