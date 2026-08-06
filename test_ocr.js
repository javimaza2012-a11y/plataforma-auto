const fs = require('fs');

async function testOcr() {
  const pdfImgConvert = require('pdf-img-convert');
  const { createWorker } = require('tesseract.js');

  console.log('Convertiendo PDF a imágenes para OCR...');
  const pdfPath = 'c:/Users/Javi/Documents/Proyectos/antigravity/PlataformaAUTO/debug_last_upload.pdf';
  const pdfBuffer = fs.readFileSync(pdfPath);
  
  const pageImages = await pdfImgConvert.convert(pdfBuffer, {
    scale: 2.0,
    page_numbers: [1, 2, 3]
  });

  console.log(`Páginas convertidas a imágenes: ${pageImages.length}`);
  
  const worker = await createWorker('spa');
  
  for (let i = 0; i < pageImages.length; i++) {
    console.log(`\n=================== OCR PÁGINA ${i + 1} ===================`);
    const ret = await worker.recognize(pageImages[i]);
    console.log(ret.data.text);
  }

  await worker.terminate();
}

testOcr().catch(console.error);
