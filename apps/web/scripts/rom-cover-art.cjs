// Draws the ROM cover artwork (D53): the Elastic glyph as a raised outline, tilted, in the cover's blues, like the
// template's cover. The six glyph pieces come from the official logo file. Every wall, outer or between pieces, has
// the same thickness: the openings are the pieces shrunk by a little, the outer edge is the glyph grown by a little,
// and the wall is what lies between. The raised side is the same shape repeated a little lower in a darker blue.
// Regenerate with:  node apps/web/scripts/rom-cover-art.cjs
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '../src/rom/assets');
const logo = fs.readFileSync(path.join(dir, 'elastic-logo-white.svg'), 'utf8');
const pieceData = [...logo.matchAll(/<path d="([^"]*)" fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]);
if (pieceData.length !== 6) throw new Error(`expected the 6 glyph pieces in the logo, found ${pieceData.length}`);

const WALL = +(process.env.WALL || 3.6); // glyph units (the glyph is about 82 across)
const DEPTH = 26, STEP = 1.6, SCALE = 7.2, ROT = 18, GRID = 0.12;
const FACE = '#0B64DD', SIDE = '#0A50B4', LINE = '#0D2E63';

// Flatten each piece's path (M, L, H, V, C, Z; absolute) into a polygon.
function flatten(d) {
  const toks = d.match(/[MLHVCZ]|-?\d*\.?\d+(?:e-?\d+)?/gi);
  const pts = []; let i = 0, cmd = '', x = 0, y = 0;
  const num = () => +toks[i++];
  while (i < toks.length) {
    if (/[A-Za-z]/.test(toks[i])) cmd = toks[i++];
    if (cmd === 'M' || cmd === 'L') { x = num(); y = num(); pts.push([x, y]); }
    else if (cmd === 'H') { x = num(); pts.push([x, y]); }
    else if (cmd === 'V') { y = num(); pts.push([x, y]); }
    else if (cmd === 'C') {
      const [x1, y1, x2, y2, x3, y3] = [num(), num(), num(), num(), num(), num()];
      for (let t = 1 / 16; t <= 1.0001; t += 1 / 16) {
        const u = 1 - t;
        pts.push([u ** 3 * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x3, u ** 3 * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y3]);
      }
      x = x3; y = y3;
    } else if (/z/i.test(cmd)) { /* closed */ } else throw new Error(`unsupported path command ${cmd}`);
  }
  return pts;
}
const pieces = pieceData.map(flatten);
const inside = (p, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const segDist = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
const edgeDist = (p, poly) => { let m = Infinity; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) m = Math.min(m, segDist(p, poly[j], poly[i])); return m; };

// The gap between neighbouring pieces in the logo; walls are built around it.
let gap = Infinity;
for (let a = 0; a < pieces.length; a++) for (let b = a + 1; b < pieces.length; b++) for (const p of pieces[a]) { const dd = edgeDist(p, pieces[b]); if (dd < gap) gap = dd; }
const shrink = (WALL - gap) / 2, grow = (WALL + gap) / 2;

// Signed field: > 0 on the wall (inside the grown glyph and not inside a shrunk piece).
const field = (x, y) => {
  const p = [x, y]; let outer = -Infinity, hole = -Infinity;
  for (const poly of pieces) {
    const dd = edgeDist(p, poly), inP = inside(p, poly);
    outer = Math.max(outer, inP ? grow + dd : grow - dd);
    if (inP) hole = Math.max(hole, dd - shrink);
  }
  return Math.min(outer, -hole === Infinity ? outer : -hole);
};
// Marching squares over the glyph, stitched into loops, simplified.
const x0 = -grow - 1, y0 = -grow - 1, N = Math.ceil((84 + 2 * grow) / GRID);
const v = Array.from({ length: N + 1 }, (_, j) => Array.from({ length: N + 1 }, (_, i) => field(x0 + i * GRID, y0 + j * GRID)));
const lerp = (ax, ay, av, bx, by, bv) => { const t = av / (av - bv); return [ax + t * (bx - ax), ay + t * (by - ay)]; };
const segs = [];
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const x = x0 + i * GRID, y = y0 + j * GRID, a = v[j][i], b = v[j][i + 1], c = v[j + 1][i + 1], d = v[j + 1][i];
  const pts = [];
  if ((a > 0) !== (b > 0)) pts.push(lerp(x, y, a, x + GRID, y, b));
  if ((b > 0) !== (c > 0)) pts.push(lerp(x + GRID, y, b, x + GRID, y + GRID, c));
  if ((c > 0) !== (d > 0)) pts.push(lerp(x + GRID, y + GRID, c, x, y + GRID, d));
  if ((d > 0) !== (a > 0)) pts.push(lerp(x, y + GRID, d, x, y, a));
  if (pts.length === 2) segs.push(pts); else if (pts.length === 4) segs.push([pts[0], pts[1]], [pts[2], pts[3]]);
}
const key = (p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
const adj = new Map();
for (const [p, q] of segs) for (const [a, b] of [[p, q], [q, p]]) { const k = key(a); if (!adj.has(k)) adj.set(k, []); adj.get(k).push(b); }
const used = new Set(), loops = [];
for (const [p] of segs) {
  if (used.has(key(p))) continue;
  const loop = [p]; used.add(key(p)); let cur = p;
  for (;;) { const next = (adj.get(key(cur)) || []).find((q) => !used.has(key(q))); if (!next) break; used.add(key(next)); loop.push(next); cur = next; }
  if (loop.length > 20) loops.push(loop);
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  let idx = 0, max = 0; const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) { const dd = segDist(pts[i], a, b); if (dd > max) { max = dd; idx = i; } }
  return max > eps ? [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)] : [a, b];
}
const f = (n) => +n.toFixed(2);
const shape = loops.map((l) => 'M' + rdp(l, 0.06).map((p) => `${f(p[0])} ${f(p[1])}`).join('L') + 'Z').join('');

// Turn the glyph about its centre, lay it back, scale it up, and centre it in the drawing.
const rot = (ROT * Math.PI) / 180, cs = Math.cos(rot), sn = Math.sin(rot);
const T = [0.96, -0.2, 0.32, 0.74].map((x) => x * SCALE);
const M = [T[0] * cs + T[2] * sn, T[1] * cs + T[3] * sn, -T[0] * sn + T[2] * cs, -T[1] * sn + T[3] * cs];
const tilt = `matrix(${M.map((x) => x.toFixed(4)).join(' ')} ${(330 - M[0] * 41 - M[2] * 41).toFixed(2)} ${(330 - M[1] * 41 - M[3] * 41).toFixed(2)})`;
const layer = (dy, fill, outline) => `<path transform="translate(0 ${dy.toFixed(2)}) ${tilt}" d="${shape}" fill="${fill}" fill-rule="evenodd"${outline ? ` stroke="${LINE}" stroke-width="${(1.6 / SCALE).toFixed(3)}" stroke-linejoin="round"` : ''}/>`;
let body = '';
for (let k = DEPTH; k > 0; k -= STEP) body += layer(k, SIDE, k === DEPTH);
body += layer(0, FACE, true);
const out = process.argv[2] || path.join(dir, 'cover-art.svg');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640">${body}</svg>`;
fs.writeFileSync(out, svg);
console.log(`${out}: ${loops.length} edges, gap ${gap.toFixed(2)}, ${svg.length} bytes`);
