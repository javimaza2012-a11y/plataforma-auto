const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

async function inspectRaw() {
  const buf = fs.readFileSync('c:/Users/Javi/Documents/Proyectos/antigravity/PlataformaAUTO/debug_last_upload.pdf');
  const pdfDoc = await PDFDocument.load(buf);
  
  for (let i = 0; i < Math.min(3, pdfDoc.getPageCount()); i++) {
    const page = pdfDoc.getPage(i);
    const node = page.node;
    console.log(`\n=== DATOS PÁGINA ${i + 1} ===`);
    console.log('Keys en node:', Array.from(node.dict.keys()).map(k => k.toString()));
    
    const contents = node.Contents();
    if (contents) {
      console.log('Contents existe, tipo:', contents.constructor.name);
    }
  }
}

inspectRaw().catch(console.error);
