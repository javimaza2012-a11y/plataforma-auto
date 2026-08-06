const fs = require('fs');

async function testMupdfOcrRotated() {
  const mupdf = await import('mupdf');
  const { createWorker } = require('tesseract.js');

  const buf = fs.readFileSync('c:/Users/Javi/Documents/Proyectos/antigravity/PlataformaAUTO/debug_last_upload.pdf');
  const doc = mupdf.Document.openDocument(buf, 'application/pdf');
  const pageCount = doc.countPages();
  
  console.log(`Documento cargado con MuPDF! Total páginas: ${pageCount}`);

  const worker = await createWorker('spa');

  for (let pageNum = 1; pageNum < Math.min(4, pageCount); pageNum++) {
    console.log(`\n--- Renderizando Página ${pageNum + 1} (Rotada 180º con scale(-2, -2)) ---`);
    const page = doc.loadPage(pageNum);
    
    // mupdf.Matrix.scale(-2, -2) equivale a escalar x2 y rotar 180 grados
    const matrix = mupdf.Matrix.scale(-2.0, -2.0);
    const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
    const pngBuffer = Buffer.from(pixmap.asPNG());

    const res = await worker.recognize(pngBuffer);
    console.log(`\n=================== RESULTADO OCR PÁGINA ${pageNum + 1} (ROTADA 180º) ===================`);
    console.log(res.data.text.substring(0, 1800));
  }

  await worker.terminate();
}

testMupdfOcrRotated().catch(console.error);
