const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

async function inspectContentsStream() {
  const buf = fs.readFileSync('c:/Users/Javi/Documents/Proyectos/antigravity/PlataformaAUTO/debug_last_upload.pdf');
  const pdfDoc = await PDFDocument.load(buf);
  
  const page1 = pdfDoc.getPage(0);
  const contentsStream = page1.node.Contents();
  const bytes = contentsStream.asUint8Array();
  const textContent = new TextDecoder('latin1').decode(bytes);

  console.log('=== STREAM DESCOMPRIMIDO PÁGINA 1 (Primeros 1500 caracteres) ===');
  console.log(textContent.substring(0, 1500));
}

inspectContentsStream().catch(console.error);
