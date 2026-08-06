const fs = require('fs');
const pdfjs = require('pdfjs-dist');

async function extractText() {
  const buf = fs.readFileSync('c:/Users/Javi/Documents/Proyectos/antigravity/PlataformaAUTO/debug_last_upload.pdf');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  console.log('Total páginas en pdfjs-dist:', doc.numPages);
  
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map(item => item.str);
    console.log(`\n=== PÁGINA ${i} (${strings.length} elementos de texto) ===`);
    console.log(strings.join(' '));
  }
}

extractText().catch(err => console.error('Error:', err));
