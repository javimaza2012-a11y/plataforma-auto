const fs = require('fs');

async function testPage2Enhanced() {
  const mupdf = await import('mupdf');
  const { createWorker } = require('tesseract.js');

  const buf = fs.readFileSync('c:/Users/Javi/Documents/Proyectos/antigravity/PlataformaAUTO/debug_last_upload.pdf');
  const doc = mupdf.Document.openDocument(buf, 'application/pdf');
  
  // Página 2 (índice 1)
  const page = doc.loadPage(1);
  
  // Probar escala 2.5 para máxima claridad de fuente pequeña
  const matrix = mupdf.Matrix.scale(-2.5, -2.5);
  const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
  const pngBuffer = Buffer.from(pixmap.asPNG());

  fs.writeFileSync('c:/Users/Javi/Documents/Proyectos/antigravity/PlataformaAUTO/page2_2.5x.png', pngBuffer);

  const worker = await createWorker('spa');
  
  // Configurar parámetros Tesseract para lectura de tablas
  await worker.setParameters({
    tessedit_pageseg_mode: '6', // Assume a single uniform block of text (tables)
  });

  const res = await worker.recognize(pngBuffer);
  console.log('=================== OCR PÁGINA 2 CON ESCALA 2.5X Y PSM 6 ===================');
  console.log(res.data.text);

  await worker.terminate();
}

testPage2Enhanced().catch(console.error);
