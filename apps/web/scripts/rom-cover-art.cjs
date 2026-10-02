// Draws the ROM cover artwork (D53): the Elastic glyph as a raised outline, tilted, in the cover's blues, like the
// template's cover. The six glyph pieces come from the official logo file; each piece's edge becomes a wall, and the
// raised side is the same walls repeated a little lower in a darker blue. Regenerate with:
//   node apps/web/scripts/rom-cover-art.cjs
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '../src/rom/assets');
const logo = fs.readFileSync(path.join(dir, 'elastic-logo-white.svg'), 'utf8');
const pieces = [...logo.matchAll(/<path d="([^"]*)" fill="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]);
if (pieces.length !== 6) throw new Error(`expected the 6 glyph pieces in the logo, found ${pieces.length}`);

const opt = { wall: +(process.env.WALL || 3.9), depth: +(process.env.DEPTH || 26), step: 1.25, scale: +(process.env.SCALE || 7.2) };
const FACE = '#0B64DD', SIDE = '#0A50B4', LINE = '#0D2E63', LINE_PX = 1.6;
// Glyph units (about 82 across) to page: scale up, then tilt so the glyph lies back like the template's.
// Turn the glyph (about its centre, 41,41) by ROT degrees, then lay it back with a fixed tilt and scale it up.
const rot = (+(process.env.ROT || 18) * Math.PI) / 180, [cs, sn] = [Math.cos(rot), Math.sin(rot)];
const T = [0.96, -0.2, 0.32, 0.74].map((v) => v * opt.scale); // a b c d
const M = [T[0] * cs + T[2] * sn, T[1] * cs + T[3] * sn, -T[0] * sn + T[2] * cs, -T[1] * sn + T[3] * cs];
const cx = 41, cy = 41, ox = +(process.env.OX || 330), oy = +(process.env.OY || 330);
const tilt = `matrix(${M.map((v) => v.toFixed(4)).join(' ')} ${(ox - M[0] * cx - M[2] * cy).toFixed(2)} ${(oy - M[1] * cx - M[3] * cy).toFixed(2)})`;
const d = pieces.join('');
const lw = opt.wall, ow = opt.wall + LINE_PX / opt.scale;
const layer = (dy, fill, outline) => `<g transform="translate(0 ${dy.toFixed(2)}) ${tilt}" fill="none" stroke-linejoin="round">` +
  (outline ? `<path d="${d}" stroke="${LINE}" stroke-width="${ow.toFixed(3)}"/>` : '') +
  `<path d="${d}" stroke="${fill}" stroke-width="${lw}"/></g>`;
let body = '';
for (let k = opt.depth; k > 0; k -= opt.step) body += layer(k, SIDE, k === opt.depth);
body += layer(0, FACE, true);
const out = process.argv[2] || path.join(dir, 'cover-art.svg');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640">${body}</svg>`;
fs.writeFileSync(out, svg);
console.log(`${out}: ${svg.length} bytes`);
