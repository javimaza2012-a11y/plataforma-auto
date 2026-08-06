const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');
const { createWorker } = require('tesseract.js');

if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {
    constructor() {
      this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
    }
  };
}

class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    return {
      canvas,
      context,
    };
  }
  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

async function testCanvasOcr() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  
  const workerPath = path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'file:///' + workerPath.replace(/\\/g, '/');

  const buf = fs.readFileSync('c:/Users/Javi/Documents/Proyectos/antigravity/PlataformaAUTO/debug_last_upload.pdf');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    verbosity: 0
  }).promise;

  console.log(`Documento PDF cargado con worker y CanvasFactory. Total páginas: ${doc.numPages}`);
  const worker = await createWorker('spa');

  const canvasFactory = new NodeCanvasFactory();

  for (let pageNum = 1; pageNum <= Math.min(3, doc.numPages); pageNum++) {
    console.log(`\n--- Renderizando Página ${pageNum} ---`);
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.0 });

    const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);

    const renderContext = {
      canvasContext: canvasAndContext.context,
      viewport: viewport,
      canvasFactory: canvasFactory
    };

    await page.render(renderContext).promise;

    const imgBuffer = canvasAndContext.canvas.toBuffer('image/png');
    fs.writeFileSync(`c:/Users/Javi/Documents/Proyectos/antigravity/PlataformaAUTO/page_${pageNum}.png`, imgBuffer);

    console.log(`Página ${pageNum} guardada como page_${pageNum}.png (${imgBuffer.length} bytes). Ejecutando OCR...`);

    const res = await worker.recognize(imgBuffer);
    console.log(`\n=================== RESULTADO OCR PÁGINA ${pageNum} ===================`);
    console.log(res.data.text.substring(0, 1500));
  }

  await worker.terminate();
}

testCanvasOcr().catch(console.error);
