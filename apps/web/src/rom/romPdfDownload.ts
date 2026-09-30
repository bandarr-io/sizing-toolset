import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff?url';
import inter400i from '@fontsource/inter/files/inter-latin-400-italic.woff?url';
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff?url';
import inter700i from '@fontsource/inter/files/inter-latin-700-italic.woff?url';
import inter800 from '@fontsource/inter/files/inter-latin-800-normal.woff?url';
import inter800i from '@fontsource/inter/files/inter-latin-800-italic.woff?url';
import type { RomInput } from './rom.ts';

/** File name in PDF_FONTS → bundled font URL. Inter ships with the app, so the PDF works offline. */
const FONT_URLS: Record<string, string> = {
  'Inter-400.woff': inter400, 'Inter-400i.woff': inter400i, 'Inter-700.woff': inter700,
  'Inter-700i.woff': inter700i, 'Inter-800.woff': inter800, 'Inter-800i.woff': inter800i,
};

function base64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** D47: builds the ROM PDF in the browser and saves it. pdfmake and the fonts load only when first used. */
export async function downloadRomPdf(input: RomInput, fileName: string): Promise<void> {
  const [{ default: pdfMake }, { romPdfDefinition, PDF_FONTS }, fonts] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('./romPdf.ts'),
    Promise.all(Object.entries(FONT_URLS).map(async ([name, url]) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`could not load the font ${name}`);
      return [name, base64(await res.arrayBuffer())] as const;
    })),
  ]);
  pdfMake.addVirtualFileSystem(Object.fromEntries(fonts));
  pdfMake.setFonts(PDF_FONTS);
  await pdfMake.createPdf(romPdfDefinition(input)).download(`${fileName}.pdf`);
}
