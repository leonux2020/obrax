// Dev helper (not part of the app bundle).
//   node scripts/sample-invoice.mjs          -> writes scripts/sample-invoice.jpg (a synthetic CLP invoice to upload in the app)
//   node scripts/sample-invoice.mjs --send   -> also POSTs it to the running dev proxy and prints the extraction
// It never reads .env.local: only the server process holds the Gemini key.
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const rows = [
  ['Cemento Polpaico 25 kg saco', '10', '4.990', '49.900'],
  ['Arena big bag 0.5 m3', '2', '14.500', '29.000'],
  ['Bloque hormigon 14 cm', '200', '890', '178.000'],
  ['Plancha yeso carton 12.5 mm 1.22x2.44', '8', '9.490', '75.920'],
  ['Pintura latex galon blanco', '3', '15.990', '47.970'],
  ['Flete despacho', '1', '12.000', '12.000'],
];
const y0 = 250;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${y0 + rows.length*70 + 200}">
<rect width="100%" height="100%" fill="#fff"/>
<text x="40" y="70" font-size="42" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" fill="#000">FERRETERIA EL MAESTRO SpA</text>
<text x="40" y="120" font-size="26" font-family="DejaVu Sans, Arial, sans-serif" fill="#000">FACTURA N 004512   Fecha: 2026-10-20   Moneda: CLP</text>
<text x="40" y="190" font-size="24" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" fill="#000">Descripcion</text>
<text x="600" y="190" font-size="24" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" fill="#000">Cant</text>
<text x="700" y="190" font-size="24" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" fill="#000">P.Unit</text>
<text x="860" y="190" font-size="24" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" fill="#000">Total</text>
${rows.map((r,i)=>`<text x="40" y="${y0+i*70}" font-size="24" font-family="DejaVu Sans, Arial, sans-serif" fill="#000">${r[0]}</text><text x="600" y="${y0+i*70}" font-size="24" font-family="DejaVu Sans, Arial, sans-serif" fill="#000">${r[1]}</text><text x="700" y="${y0+i*70}" font-size="24" font-family="DejaVu Sans, Arial, sans-serif" fill="#000">${r[2]}</text><text x="850" y="${y0+i*70}" font-size="24" font-family="DejaVu Sans, Arial, sans-serif" fill="#000">${r[3]}</text>`).join('')}
<text x="40" y="${y0+rows.length*70+60}" font-size="26" font-family="DejaVu Sans, Arial, sans-serif" fill="#000">Neto: 392.790   IVA 19%: 74.630   TOTAL: 467.420  (precios unitarios netos)</text>
</svg>`;
const buf = await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
const out = path.join(here, 'sample-invoice.jpg');
fs.writeFileSync(out, buf);
console.log('wrote', out);
if (!process.argv.includes('--send')) process.exit(0);
const image = 'data:image/jpeg;base64,' + buf.toString('base64');
const t0 = Date.now();
const r = await fetch(`http://localhost:${PORT}/api/extract-invoice`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://localhost:${PORT}`, host: `localhost:${PORT}` }, body: JSON.stringify({ image, currency: 'CLP', lang: 'es' }) });
console.log(r.status, Date.now() - t0, 'ms', buf.length, 'bytes');
console.log(JSON.stringify(await r.json(), null, 1));
