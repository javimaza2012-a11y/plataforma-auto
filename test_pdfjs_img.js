const fs = require('fs');
const path = require('path');

async function testPdfJsImages() {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    globalThis.DOMMatrix = class DOMMatrix {
      constructor() {
        this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
      }
    };
  }

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createWorker } = require('tesseract.js');

  const workerPath = path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'file:///' + workerPath.replace(/\\/g, '/');

  const buf = fs.readFileSync('c:/Users/Javi/Documents/Proyectos/antigravity/PlataformaAUTO/debug_last_upload.pdf');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    verbosity: 0
  }).promise;

  console.log(`Documento PDF cargado con worker JBIG2. Total páginas: ${doc.numPages}`);

  for (let pageNum = 1; pageNum <= Math.min(3, doc.numPages); pageNum++) {
    console.log(`\n--- Extrayendo imagen de Página ${pageNum} ---`);
    const page = await doc.getPage(pageNum);
    const ops = await page.getOperatorList();
    
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      const args = ops.argsArray[i];
      
      if (fn === pdfjs.OPS.paintImageXObject) {
        const imgName = args[0];
        console.log(`Procesando imagen JBIG2: ${imgName}`);
        
        await new Promise((resolve) => {
          page.objs.get(imgName, async (imgData) => {
            if (!imgData) {
              console.log('No se obtuvo imgData para', imgName);
              return resolve();
            }

            console.log(`¡Imagen JBIG2 DECODIFICADA CON ÉXITO! Ancho: ${imgData.width}, Alto: ${imgData.height}, Bytes: ${imgData.data.length}`);

            const width = imgData.width;
            const height = imgData.height;
            const rgba = new Uint8ClampedArray(width * height * 4);

            if (imgData.data.length === width * height) {
              for (let j = 0; j < width * height; j++) {
                const val = imgData.data[j];
                rgba[j * 4] = val;
                rgba[j * 4 + 1] = val;
                rgba[j * 4 + 2] = val;
                rgba[j * 4 + 3] = 255;
              }
            } else if (imgData.data.length === width * height * 3) {
              for (let j = 0; j < width * height; j++) {
                rgba[j * 4] = imgData.data[j * 3];
                rgba[j * 4 + 1] = imgData.data[j * 3 + 1];
                rgba[j * 4 + 2] = imgData.data[j * 3 + 2];
                rgba[j * 4 + 3] = 255;
              }
            } else if (imgData.data.length === width * height * 4) {
              rgba.set(imgData.data);
            }

            console.log(`Ejecutando Tesseract OCR en Página ${pageNum}...`);
            const worker = await createWorker('spa');
            const res = await worker.recognize({
              data: Buffer.from(rgba.buffer),
              width: width,
              height: height,
              depth: 4
            });
            await worker.terminate();

            console.log(`\n=================== OCR PÁGINA ${pageNum} RESULTADO ===================`);
            console.log(res.data.text.substring(0, 1500));
            resolve();
          });
        });
      }
    }
  }
}

testPdfJsImages().catch(console.error);
