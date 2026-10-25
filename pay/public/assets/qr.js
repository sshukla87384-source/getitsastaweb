// Chhota QR code generator (byte mode, error correction M, version 1–10). Koi library nahi.
// QR.svg(text) → <svg> string
(function (root) {
  // [ecc codewords per block, group1 blocks, group1 data cw, group2 blocks, group2 data cw]  — level M
  const EC = [null, [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]];
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  // GF(256)
  const EXP = new Array(512), LOG = new Array(256);
  for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
  function rsGen(n) {
    let g = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= mul(g[j], EXP[i]); }
      g = next;
    }
    return g;
  }
  function rsRem(data, n) {
    const g = rsGen(n), r = data.concat(new Array(n).fill(0));
    for (let i = 0; i < data.length; i++) { const c = r[i]; if (c) for (let j = 0; j < g.length; j++) r[i + j] ^= mul(g[j], c); }
    return r.slice(data.length);
  }

  function encode(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    let ver = 1;
    for (; ver <= 10; ver++) {
      const [, b1, d1, b2, d2] = EC[ver];
      const cap = b1 * d1 + b2 * d2;
      if (4 + (ver < 10 ? 8 : 16) + bytes.length * 8 <= cap * 8) break;
    }
    if (ver > 10) throw new Error('QR: text bahut lamba hai');
    const [ecn, b1, d1, b2, d2] = EC[ver];
    const dataCw = b1 * d1 + b2 * d2;

    // bit stream
    const bits = [];
    const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16);
    for (const b of bytes) put(b, 8);
    put(0, Math.min(4, dataCw * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    const cw = [];
    for (let i = 0; i < bits.length; i += 8) cw.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let p = 0; cw.length < dataCw; p++) cw.push(p % 2 ? 0x11 : 0xec);

    // blocks + interleave
    const blocks = [];
    let off = 0;
    for (let i = 0; i < b1 + b2; i++) { const len = i < b1 ? d1 : d2; const d = cw.slice(off, off + len); off += len; blocks.push({ d, e: rsRem(d, ecn) }); }
    const final = [];
    for (let i = 0; i < Math.max(d1, d2); i++) for (const b of blocks) if (i < b.d.length) final.push(b.d[i]);
    for (let i = 0; i < ecn; i++) for (const b of blocks) final.push(b.e[i]);

    // matrix
    const size = ver * 4 + 17;
    const m = Array.from({ length: size }, () => new Array(size).fill(null));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (r, c, v) => { m[r][c] = v ? 1 : 0; fn[r][c] = true; };
    const finder = (r, c) => {
      for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) {
        const rr = r + i, cc = c + j;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const on = i >= 0 && i <= 6 && j >= 0 && j <= 6 && (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4));
        set(rr, cc, on);
      }
    };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const al = ALIGN[ver];
    for (const r of al) for (const c of al) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) set(r + i, c + j, Math.max(Math.abs(i), Math.abs(j)) !== 1);
    }
    set(size - 8, 8, 1);   // dark module
    // format + version areas reserve
    for (let i = 0; i < 9; i++) { if (!fn[8][i]) set(8, i, 0); if (!fn[i][8]) set(i, 8, 0); }
    for (let i = 0; i < 8; i++) { if (!fn[8][size - 1 - i]) set(8, size - 1 - i, 0); if (!fn[size - 1 - i][8]) set(size - 1 - i, 8, 0); }
    if (ver >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { set(i, size - 11 + j, 0); set(size - 11 + j, i, 0); }

    // data placement (zigzag)
    const dataBits = [];
    for (const b of final) for (let i = 7; i >= 0; i--) dataBits.push((b >>> i) & 1);
    let k = 0;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (let n = 0; n < size; n++) {
        const up = ((col + 1) & 2) === 0;
        const row = up ? size - 1 - n : n;
        for (const c of [col, col - 1]) if (!fn[row][c]) m[row][c] = k < dataBits.length ? dataBits[k++] : 0;
      }
    }

    const MASKS = [(r, c) => (r + c) % 2 === 0, r => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
      (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
      (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0];

    const bch = (v, poly, deg) => { let x = v << deg; const top = Math.floor(Math.log2(poly)); while (x && Math.floor(Math.log2(x)) >= top) x ^= poly << (Math.floor(Math.log2(x)) - top); return (v << deg) | x; };
    function drawFormatStd(g, mask) {
      const f = bch((0b00 << 3) | mask, 0x537, 10) ^ 0x5412;
      const b = i => (f >>> i) & 1;
      // vertical (column 8) near top-left: bits 0-5 rows 0-5, bit6 row7, bit7 row8, bits 8 col7 … (standard layout)
      for (let i = 0; i <= 5; i++) g[i][8] = b(i);
      g[7][8] = b(6); g[8][8] = b(7); g[8][7] = b(8);
      for (let i = 9; i < 15; i++) g[8][14 - i] = b(i);
      // horizontal top-right + vertical bottom-left
      for (let i = 0; i < 8; i++) g[8][size - 1 - i] = b(i);
      for (let i = 8; i < 15; i++) g[size - 15 + i][8] = b(i);
      g[size - 8][8] = 1;
    }
    function drawVersion(g) {
      if (ver < 7) return;
      const v = bch(ver, 0x1f25, 12);
      for (let i = 0; i < 18; i++) {
        const bit = (v >>> i) & 1, a = Math.floor(i / 3), b = i % 3;
        g[a][size - 11 + b] = bit; g[size - 11 + b][a] = bit;
      }
    }
    function penalty(g) {
      let p = 0;
      for (let r = 0; r < size; r++) for (const line of [g[r], g.map(row => row[r])]) {
        let run = 1;
        for (let i = 1; i <= size; i++) {
          if (i < size && line[i] === line[i - 1]) run++;
          else { if (run >= 5) p += run - 2; run = 1; }
        }
        const s = line.join('');
        p += 40 * ((s.match(/(?=10111010000)/g) || []).length + (s.match(/(?=00001011101)/g) || []).length);
      }
      for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
        const v = g[r][c]; if (v === g[r][c + 1] && v === g[r + 1][c] && v === g[r + 1][c + 1]) p += 3;
      }
      const dark = g.flat().reduce((a, b) => a + b, 0);
      p += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
      return p;
    }
    let best = null, bestP = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const g = m.map((row, r) => row.map((v, c) => (fn[r][c] ? v : v ^ (MASKS[mask](r, c) ? 1 : 0))));
      drawFormatStd(g, mask); drawVersion(g);
      const p = penalty(g);
      if (p < bestP) { bestP = p; best = g; }
    }
    return best;
  }

  function svg(text, { margin = 4, dark = '#1B1240', light = '#ffffff' } = {}) {
    const g = encode(text), n = g.length, s = n + margin * 2;
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (g[r][c]) d += `M${c + margin} ${r + margin}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${s}" height="${s}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
  }

  const QR = { encode, svg };
  if (typeof module !== 'undefined' && module.exports) module.exports = QR; else root.QR = QR;
})(this);
