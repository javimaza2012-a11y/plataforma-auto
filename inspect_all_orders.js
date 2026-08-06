const fs = require('fs');

async function inspectAllPages() {
  const mupdf = await import('mupdf');
  const { createWorker } = require('tesseract.js');

  const buf = fs.readFileSync('c:/Users/Javi/Documents/Proyectos/antigravity/PlataformaAUTO/debug_last_upload.pdf');
  const doc = mupdf.Document.openDocument(buf, 'application/pdf');
  const pageCount = doc.countPages();

  console.log(`Documento cargado con MuPDF! Total páginas: ${pageCount}`);

  const worker = await createWorker('spa');

  for (let pageNum = 0; pageNum < pageCount; pageNum++) {
    const page = doc.loadPage(pageNum);
    
    // Rotar 180 grados y escalar x2
    const matrix180 = mupdf.Matrix.scale(-2.0, -2.0);
    const pixmap180 = page.toPixmap(matrix180, mupdf.ColorSpace.DeviceRGB, false, true);
    const pngBuffer180 = Buffer.from(pixmap180.asPNG());

    const res180 = await worker.recognize(pngBuffer180);
    const text180 = res180.data.text || '';

    if (text180.includes('RECAPITULATIVO') || text180.includes('EXPEDICION') || text180.includes('PEDCLIENT') || text180.includes('END OF REPORT')) {
      console.log(`\n=================== OCR PÁGINA ${pageNum + 1} (ROTADA 180º) ===================`);
      console.log(text180);
    }
  }

  await worker.terminate();
}

inspectAllPages().catch(console.error);
