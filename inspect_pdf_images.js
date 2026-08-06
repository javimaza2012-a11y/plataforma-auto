const fs = require('fs');
const { PDFDocument, PDFName, PDFRawStream } = require('pdf-lib');

async function extractRawImages() {
  const buf = fs.readFileSync('c:/Users/Javi/Documents/Proyectos/antigravity/PlataformaAUTO/debug_last_upload.pdf');
  const pdfDoc = await PDFDocument.load(buf);
  
  console.log(`Páginas totales: ${pdfDoc.getPageCount()}`);

  const images = [];

  for (let i = 0; i < pdfDoc.getPageCount(); i++) {
    const page = pdfDoc.getPage(i);
    const resources = page.node.Resources();
    if (!resources) continue;
    
    const xObjectMap = resources.get(PDFName.of('XObject'));
    if (!xObjectMap) continue;

    const keys = xObjectMap.dict ? Array.from(xObjectMap.dict.keys()) : [];
    for (const key of keys) {
      const xObj = xObjectMap.get(key);
      if (xObj) {
        // Verificar si es imagen
        const subtype = xObj.dict ? xObj.dict.get(PDFName.of('Subtype')) : null;
        if (subtype && subtype.toString() === '/Image') {
          console.log(`Página ${i + 1}: Encontrada XObject Imagen (${key})`);
          images.push({ pageIndex: i, xObj });
        }
      }
    }
  }

  console.log(`Total imágenes de página escaneada encontradas: ${images.length}`);
}

extractRawImages().catch(console.error);
