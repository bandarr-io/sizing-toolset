// Official Elastic logo with tagline, white, for the blue cover (Dan, 2026-10-02).
import logoSvg from './assets/elastic-logo-white.svg?raw';
// Cover artwork: the Elastic glyph from the logo, drawn as a raised outline (scripts/rom-cover-art.cjs), D53.
import coverArtSvg from './assets/cover-art.svg?raw';

/**
 * Branding for the Budgetary ROM. The logo is the official file in ./assets; the cover artwork is drawn by
 * scripts/rom-cover-art.cjs. To use an official artwork file instead, put it in ./assets and import it here.
 */
export const BRAND = {
  /** Elastic blue from the ROM template. */
  blue: '#0B64DD',
  /** Inter, as in the template; system fonts when offline. */
  fontLink: '<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,600;0,700;0,800;1,400;1,700&display=swap" rel="stylesheet">',
  fontStack: 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif',
  /** Logo with tagline (white on blue) for the cover. */
  logoSvg,
  /** Cover artwork: the Elastic glyph as a raised, tilted outline, bottom right. */
  coverArtSvg,
};
