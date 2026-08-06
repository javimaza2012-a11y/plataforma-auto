const fs = require('fs');
const pdfParse = require('pdf-parse');

async function test() {
  const buf = fs.readFileSync('c:/Users/Javi/Documents/Proyectos/antigravity/PlataformaAUTO/debug_last_upload.pdf');
  const data = await pdfParse(buf);
  console.log('Total páginas:', data.numpages);
  console.log('Longitud texto:', data.text ? data.text.length : 0);
  console.log('\n================ MOSTRANDO PRIMEROS 2000 CARACTERES ================');
  console.log(data.text ? data.text.substring(0, 2000) : 'TEXTO VACÍO');
}

test().catch(err => console.error(err));
