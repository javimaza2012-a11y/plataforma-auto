const fs = require('fs');
const { PDFDocument, PDFName } = require('pdf-lib');

async function extractIm1() {
  const buf = fs.readFileSync('c:/Users/Javi/Documents/Proyectos/antigravity/PlataformaAUTO/debug_last_upload.pdf');
  const pdfDoc = await PDFDocument.load(buf);
  
  const page1 = pdfDoc.getPage(0);
  const resources = page1.node.Resources();
  const xObjectMap = resources.get(PDFName.of('XObject'));
  
  const im1Ref = xObjectMap.get(PDFName.of('Im1'));
  const im1 = pdfDoc.context.lookup(im1Ref);

  console.log('Objeto Im1 resuelto:', im1.constructor.name);
  
  const keys = Array.from(im1.dict.keys()).map(k => k.toString());
  console.log('Keys de Im1:', keys);

  const filter = im1.dict.get(PDFName.of('Filter'));
  console.log('Filtro de compresión:', filter ? filter.toString() : 'Sin filtro');

  const width = im1.dict.get(PDFName.of('Width')).toString();
  const height = im1.dict.get(PDFName.of('Height')).toString();
  console.log(`Dimensiones de la imagen escaneada: ${width} x ${height}`);

  const bytes = im1.asUint8Array();
  console.log(`Tamaño de bytes de la imagen: ${bytes.length} bytes`);
  
  if (filter && filter.toString().includes('DCTDecode')) {
    fs.writeFileSync('c:/Users/Javi/Documents/Proyectos/antigravity/PlataformaAUTO/page1.jpg', bytes);
    console.log('¡Guardado con éxito como page1.jpg!');
  } else {
    fs.writeFileSync('c:/Users/Javi/Documents/Proyectos/antigravity/PlataformaAUTO/page1.raw', bytes);
    console.log('Guardado como page1.raw');
  }
}

extractIm1().catch(console.error);
