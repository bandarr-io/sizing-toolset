// Draws the ROM cover artwork: the Elastic cluster mark as a raised outline, tilted, in the cover's blues (D53).
// Drawn by hand in the style of the template's cover (no source file exists). Regenerate with:
//   node apps/web/scripts/rom-cover-art.cjs apps/web/src/rom/assets/cover-art.svg
// The mark is a solid shape (the lobes grown by half a wall) with its openings cut out, so every edge is exact;
// the raised side is the same shape repeated a little lower in a darker blue.
const fs = require('fs');
const C = { T: [230, 150, 105], R: [430, 190, 175], L: [130, 300, 125], B: [330, 440, 170] };
const J = [290, 290];
const W = 26, DEPTH = 24, STEP = 1.5, G = 1.5;
const FACE = '#0B64DD', SIDE = '#0A50B4', LINE = '#0D2E63';
// The four lobes leave a small pocket at the centre; a hidden disc there fills it.
const circles = [...Object.values(C), [290, 280, 60]];
const f = (n) => +n.toFixed(1);
function intersections(a, b) {
  const [x0, y0, r0] = a, [x1, y1, r1] = b, d = Math.hypot(x1 - x0, y1 - y0);
  if (d >= r0 + r1 || d <= Math.abs(r0 - r1)) return [];
  const t = (r0 * r0 - r1 * r1 + d * d) / (2 * d), h = Math.sqrt(r0 * r0 - t * t);
  const mx = x0 + (t * (x1 - x0)) / d, my = y0 + (t * (y1 - y0)) / d;
  return [[mx + (h * (y1 - y0)) / d, my - (h * (x1 - x0)) / d], [mx - (h * (y1 - y0)) / d, my + (h * (x1 - x0)) / d]];
}
// Outer edge: the union of the lobes grown by half a wall, as arcs.
function unionArcs(cs) {
  let p = '';
  for (const c of cs) {
    const angles = [];
    for (const o of cs) if (o !== c) for (const q of intersections(c, o)) angles.push(Math.atan2(q[1] - c[1], q[0] - c[0]));
    angles.sort((a, b) => a - b);
    if (!angles.length) angles.push(0);
    for (let i = 0; i < angles.length; i++) {
      const a0 = angles[i], a1 = i + 1 < angles.length ? angles[i + 1] : angles[0] + 2 * Math.PI, mid = (a0 + a1) / 2;
      const pm = [c[0] + c[2] * Math.cos(mid), c[1] + c[2] * Math.sin(mid)];
      if (cs.some((o) => o !== c && Math.hypot(pm[0] - o[0], pm[1] - o[1]) < o[2])) continue;
      const p0 = [c[0] + c[2] * Math.cos(a0), c[1] + c[2] * Math.sin(a0)], p1 = [c[0] + c[2] * Math.cos(a1), c[1] + c[2] * Math.sin(a1)];
      p += `${p ? 'L' : 'M'}${f(p0[0])} ${f(p0[1])}A${c[2]} ${c[2]} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${f(p1[0])} ${f(p1[1])}`;
    }
  }
  return p + 'Z';
}
// Arcs come out in circle order, not around the outline; order them by chaining endpoints.
function chainArcs(cs) {
  const segs = [];
  for (const c of cs) {
    const angles = [];
    for (const o of cs) if (o !== c) for (const q of intersections(c, o)) angles.push(Math.atan2(q[1] - c[1], q[0] - c[0]));
    angles.sort((a, b) => a - b);
    for (let i = 0; i < angles.length; i++) {
      const a0 = angles[i], a1 = i + 1 < angles.length ? angles[i + 1] : angles[0] + 2 * Math.PI, mid = (a0 + a1) / 2;
      const pm = [c[0] + c[2] * Math.cos(mid), c[1] + c[2] * Math.sin(mid)];
      if (cs.some((o) => o !== c && Math.hypot(pm[0] - o[0], pm[1] - o[1]) < o[2])) continue;
      segs.push({ c, p0: [c[0] + c[2] * Math.cos(a0), c[1] + c[2] * Math.sin(a0)], p1: [c[0] + c[2] * Math.cos(a1), c[1] + c[2] * Math.sin(a1)], large: a1 - a0 > Math.PI ? 1 : 0 });
    }
  }
  const out = [segs.shift()];
  while (segs.length) {
    const end = out[out.length - 1].p1;
    let k = 0, best = Infinity;
    segs.forEach((s, i) => { const dd = Math.hypot(s.p0[0] - end[0], s.p0[1] - end[1]); if (dd < best) { best = dd; k = i; } });
    out.push(segs.splice(k, 1)[0]);
  }
  return `M${f(out[0].p0[0])} ${f(out[0].p0[1])}` + out.map((s) => `A${s.c[2]} ${s.c[2]} 0 ${s.large} 1 ${f(s.p1[0])} ${f(s.p1[1])}`).join('') + 'Z';
}
const outer = chainArcs(circles.map(([x, y, r]) => [x, y, r + W / 2]));
// Openings: inside the lobes shrunk by half a wall, and more than half a wall from every inner wall.
const walls = [['T', 'L'], ['T', 'R'], ['L', 'B'], ['R', 'B']].map(([a, b]) => {
  const pts = intersections(C[a], C[b]).sort((p, q) => Math.hypot(q[0] - J[0], q[1] - J[1]) - Math.hypot(p[0] - J[0], p[1] - J[1]));
  // Start each wall a little behind the junction so neighbouring walls meet in straight edges.
  const dx = pts[0][0] - J[0], dy = pts[0][1] - J[1], len = Math.hypot(dx, dy), back = 0.45 * W;
  return [[J[0] - (dx / len) * back, J[1] - (dy / len) * back], pts[0]];
});
const segDist = (p, [a, b]) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
// Points along the outer edge of the mark (each lobe's arc outside the others), to measure distance to the edge.
const edge = [];
for (const c of circles) for (let k = 0; k < 720; k++) {
  const a = (k / 720) * 2 * Math.PI, p = [c[0] + c[2] * Math.cos(a), c[1] + c[2] * Math.sin(a)];
  if (!circles.some((o) => o !== c && Math.hypot(p[0] - o[0], p[1] - o[1]) < o[2])) edge.push(p);
}
const inUnion = (x, y) => circles.some(([cx, cy, r]) => Math.hypot(x - cx, y - cy) < r);
const field = (x, y) => {
  if (!inUnion(x, y)) return -W;
  let m = Infinity; for (const p of edge) { const dd = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (dd < m) m = dd; }
  const inside = Math.sqrt(m) - W / 2;
  // Walls are straight bands with square ends (no rounded caps at the junction).
  const band = ([a, b2]) => {
    const dx = b2[0] - a[0], dy = b2[1] - a[1], L2 = dx * dx + dy * dy, t = ((x - a[0]) * dx + (y - a[1]) * dy) / L2;
    if (t < 0 || t > 1.2) return Infinity;
    return Math.abs((x - a[0]) * dy - (y - a[1]) * dx) / Math.sqrt(L2);
  };
  const wall = Math.min(...walls.map((w) => band(w) - W / 2));
  return Math.min(inside, wall); // > 0 inside an opening
};
// Marching squares over the field, with linear interpolation, then stitch segments into loops.
const N = Math.ceil(700 / G), segs = [];
const v = []; for (let j = 0; j <= N; j++) { v.push([]); for (let i = 0; i <= N; i++) v[j].push(field(i * G - 30, j * G - 30)); }
const lerp = (x0, y0, v0, x1, y1, v1) => { const t = v0 / (v0 - v1); return [x0 + t * (x1 - x0), y0 + t * (y1 - y0)]; };
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const x = i * G - 30, y = j * G - 30, a = v[j][i], b = v[j][i + 1], c = v[j + 1][i + 1], d = v[j + 1][i];
  const pts = [];
  if ((a > 0) !== (b > 0)) pts.push(lerp(x, y, a, x + G, y, b));
  if ((b > 0) !== (c > 0)) pts.push(lerp(x + G, y, b, x + G, y + G, c));
  if ((c > 0) !== (d > 0)) pts.push(lerp(x + G, y + G, c, x, y + G, d));
  if ((d > 0) !== (a > 0)) pts.push(lerp(x, y + G, d, x, y, a));
  if (pts.length === 2) segs.push(pts); else if (pts.length === 4) { segs.push([pts[0], pts[1]], [pts[2], pts[3]]); }
}
const key = (p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
const adj = new Map();
for (const [p, q] of segs) { for (const [a, b] of [[p, q], [q, p]]) { const k = key(a); if (!adj.has(k)) adj.set(k, []); adj.get(k).push(b); } }
const used = new Set(), loops = [];
for (const [p] of segs) {
  if (used.has(key(p))) continue;
  const loop = [p]; used.add(key(p)); let cur = p;
  for (;;) { const next = (adj.get(key(cur)) || []).find((q) => !used.has(key(q))); if (!next) break; used.add(key(next)); loop.push(next); cur = next; }
  if (loop.length > 20) loops.push(loop);
}
// Simplify each loop (Ramer-Douglas-Peucker) so the file stays small.
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  let idx = 0, max = 0; const [a, b] = [pts[0], pts[pts.length - 1]];
  for (let i = 1; i < pts.length - 1; i++) { const d = segDist(pts[i], [a, b]); if (d > max) { max = d; idx = i; } }
  return max > eps ? [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)] : [a, b];
}
const holes = loops.map((l) => { const s = rdp(l, 0.25); return 'M' + s.map((p) => `${f(p[0])} ${f(p[1])}`).join('L') + 'Z'; }).join('');
const shape = outer + holes;
const tilt = 'matrix(0.96 -0.2 0.32 0.74 40 120)';
const layer = (dy, fill, outline) => `<path transform="translate(0 ${f(dy)}) ${tilt}" d="${shape}" fill="${fill}" fill-rule="evenodd"${outline ? ` stroke="${LINE}" stroke-width="1.6" stroke-linejoin="round"` : ''}/>`;
let body = '';
for (let k = DEPTH; k > 0; k -= STEP) body += layer(k, SIDE, k === DEPTH);
body += layer(0, FACE, true);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640">${body}</svg>`;
fs.writeFileSync(process.argv[2], svg);
console.log(`${loops.length} openings, ${svg.length} bytes`);
