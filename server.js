console.log('[STARTUP] Initializing PlataformaAUTO server...');
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const AdmZip = require('adm-zip');

console.log('[STARTUP] Core express modules loaded.');

const { parseRecapitulativo, parseAlbaran, parseBR1, mergePDFs, annotateRecapitulativo } = require('./pdfProcessor');
console.log('[STARTUP] pdfProcessor loaded.');

const { printPDF, getPrinters } = require('./printerService');
console.log('[STARTUP] printerService loaded.');

const app = express();
const PORT = process.env.PORT || 3000;

const HISTORICO_DIR = path.join(__dirname, 'historico');
const UPLOADS_DIR = path.join(__dirname, 'uploads_temp');

if (!fs.existsSync(HISTORICO_DIR)) fs.mkdirSync(HISTORICO_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/historico', express.static(HISTORICO_DIR));

const activeBatches = new Map();

/**
 * Extrae PDFs de un archivo ZIP o devuelve el archivo original si ya es PDF.
 * Soporta: .zip con múltiples PDFs, o un solo .pdf directo.
 */
function extractPdfsFromFiles(files) {
  const pdfFiles = [];

  for (const file of files) {
    const ext = path.extname(file.originalname).toLowerCase();

    if (ext === '.zip') {
      // Extraer todos los PDFs del ZIP
      try {
        const zip = new AdmZip(file.buffer);
        const entries = zip.getEntries();

        for (const entry of entries) {
          const entryName = entry.entryName.toLowerCase();
          // Ignorar carpetas, archivos ocultos y no-PDF
          if (entry.isDirectory) continue;
          if (entryName.startsWith('__macosx') || entryName.startsWith('.')) continue;
          if (!entryName.endsWith('.pdf')) continue;

          const buffer = entry.getData();
          const filename = path.basename(entry.entryName);
          pdfFiles.push({ buffer, originalname: filename });
        }
        console.log(`[ZIP] Extraídos ${pdfFiles.length} PDFs del archivo ZIP "${file.originalname}".`);
      } catch (err) {
        console.error(`[ZIP] Error al descomprimir "${file.originalname}":`, err.message);
      }
    } else if (ext === '.pdf') {
      pdfFiles.push({ buffer: file.buffer, originalname: file.originalname });
    }
    // Ignorar cualquier otro formato silenciosamente
  }

  return pdfFiles;
}

let currentSession = {
  fleteHeaderBuffer: null,
  recapBboxesByPage: {},
  ordersSequence: [],
  fleteProviderAlbaranes: [],
  userAlbaranes: [],
  br1Pages: [],
  masterBuffer: null,
  masterFileUrl: null
};

/**
 * Endpoint 1: Procesar Flete (Recapitulativo DKV)
 */
app.post('/api/recapitulativo', upload.single('recapitulativoFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se ha adjuntado ningún archivo de recapitulativo.' });
    }

    const pdfs = extractPdfsFromFiles([req.file]);
    if (pdfs.length === 0) {
      return res.status(400).json({ error: 'No se encontró ningún PDF válido en el archivo subido.' });
    }

    const pdfFile = pdfs[0];
    const debugPath = path.join(__dirname, 'debug_last_upload.pdf');
    fs.writeFileSync(debugPath, pdfFile.buffer);

    const result = await parseRecapitulativo(pdfFile.buffer);
    result.filename = pdfFile.originalname;
    result.timestamp = new Date().toISOString();

    currentSession.fleteHeaderBuffer = result.fleteHeaderBuffer;
    currentSession.recapBboxesByPage = result.recapBboxesByPage || {};
    currentSession.ordersSequence = result.ordersSequence || [];
    currentSession.fleteProviderAlbaranes = result.providerAlbaranes || [];

    console.log(`[FLETE SESSION] Registrados ${currentSession.ordersSequence.length} pedidos y ${currentSession.fleteProviderAlbaranes.length} albaranes de proveedor del Flete.`);

    const clientResult = {
      ...result,
      providerAlbaranesCount: result.providerAlbaranes ? result.providerAlbaranes.length : 0
    };
    delete clientResult.providerAlbaranes;
    delete clientResult.fleteHeaderBuffer;
    delete clientResult.recapBboxesByPage;

    res.json(clientResult);
  } catch (error) {
    console.error('Error al procesar Flete:', error);
    res.status(500).json({ error: `Error interno al procesar Flete: ${error.message}` });
  }
});

/**
 * Endpoint 2: Procesar Albaranes a Flete (Subidos por el usuario)
 */
app.post('/api/albaranes', upload.array('albaranesFiles', 200), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se han adjuntado archivos de albaranes.' });
    }

    const pdfFiles = extractPdfsFromFiles(req.files);
    if (pdfFiles.length === 0) {
      return res.status(400).json({ error: 'No se encontraron PDFs válidos en los archivos subidos.' });
    }

    console.log(`[ALBARANES] Procesando ${pdfFiles.length} albaranes PDF del usuario...`);

    const results = [];
    const validUserAlbaranes = [];

    for (const file of pdfFiles) {
      const parsed = await parseAlbaran(file.buffer, file.originalname);
      parsed.buffer = file.buffer;
      results.push(parsed);

      if (parsed.isValid) {
        validUserAlbaranes.push({
          buffer: file.buffer,
          filename: file.originalname,
          extractedOrder: parsed.extractedOrder
        });
      }
    }

    currentSession.userAlbaranes = validUserAlbaranes;

    const totalValid = results.filter(r => r.isValid).length;
    const totalDiscarded = results.filter(r => !r.isValid).length;

    const cleanResults = results.map(({ buffer, ...rest }) => rest);

    res.json({
      success: true,
      totalProcessed: pdfFiles.length,
      totalValid,
      totalDiscarded,
      results: cleanResults
    });
  } catch (error) {
    console.error('Error al procesar albaranes a Flete:', error);
    res.status(500).json({ error: `Error al procesar albaranes: ${error.message}` });
  }
});

/**
 * Endpoint 3: Procesar Documento de Descarga BR1 de SAP
 */
app.post('/api/br1', upload.single('br1File'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se ha adjuntado ningún archivo BR1.' });
    }

    const pdfs = extractPdfsFromFiles([req.file]);
    if (pdfs.length === 0) {
      return res.status(400).json({ error: 'No se encontró ningún PDF válido en el archivo subido.' });
    }

    const pdfFile = pdfs[0];
    fs.writeFileSync(path.join(__dirname, 'debug_last_br1.pdf'), pdfFile.buffer);

    const result = await parseBR1(pdfFile.buffer, pdfFile.originalname);
    currentSession.br1Pages = result.items || [];

    console.log(`[BR1 SESSION] Registradas ${currentSession.br1Pages.length} páginas BR1 de SAP.`);

    const clientResult = {
      ...result,
      items: (result.items || []).map(({ buffer, ...rest }) => rest)
    };

    res.json(clientResult);
  } catch (error) {
    console.error('Error al procesar BR1:', error);
    res.status(500).json({ error: `Error al procesar BR1: ${error.message}` });
  }
});

/**
 * Endpoint 4: Generar Lote Unificado de Impresión Maestro
 * Secuencia estricta:
 * 1. Flete inicial (Carta de porte + Recapitulativo)
 * 2. Para cada pedido del Flete (en orden): BR1 del pedido -> Albarán del pedido (Pestaña 2 o Flete)
 */
app.post('/api/generate-master-print', async (req, res) => {
  try {
    const pdfBuffers = [];
    const breakdown = [];

    // 1. Añadir carta de porte y recapitulativo del Flete, ANOTÁNDOLO primero
    if (currentSession.fleteHeaderBuffer) {
      try {
        console.log('[MASTER PRINT] Anotando el flete recapitulativo con datos BR1...');
        const annotatedFleteBuffer = await annotateRecapitulativo(
          currentSession.fleteHeaderBuffer,
          currentSession.recapBboxesByPage,
          currentSession.br1Pages
        );
        pdfBuffers.push(annotatedFleteBuffer);
        breakdown.push({ section: 'INICIO', title: 'Carta de Porte y Recapitulativo Anotado del Flete' });
      } catch (annErr) {
        console.error('[MASTER PRINT] Error anotando recapitulativo, se usará el original:', annErr);
        pdfBuffers.push(currentSession.fleteHeaderBuffer);
        breakdown.push({ section: 'INICIO', title: 'Carta de Porte y Recapitulativo del Flete (Sin Anotar)' });
      }
    }

    // 2. Recorrer la secuencia de pedidos en orden estricto del Flete
    const sequence = currentSession.ordersSequence || [];
    const availableUserOrders = (currentSession.userAlbaranes || []).map(a => a.extractedOrder);
    const availableBR1Orders = (currentSession.br1Pages || []).map(b => b.docNumberFull);
    console.log(`[MASTER PRINT] Secuencia de pedidos del Flete (${sequence.length}): ${sequence.join(', ')}`);
    console.log(`[MASTER PRINT] Albaranes usuario disponibles (${availableUserOrders.length}): ${availableUserOrders.join(', ')}`);
    console.log(`[MASTER PRINT] BR1 disponibles (${availableBR1Orders.length}): ${availableBR1Orders.join(', ')}`);

    for (let i = 0; i < sequence.length; i++) {
      const order = sequence[i];
      const orderLast4 = order.slice(-4);
      let addedBR1 = false;
      let addedAlbaran = false;
      let albSource = '';

      // A. BR1 correspondiente a este pedido
      const br1Item = (currentSession.br1Pages || []).find(b =>
        (b.docNumberFull && b.docNumberFull === order) ||
        (b.docNumberLast4 && b.docNumberLast4 === orderLast4)
      );

      if (br1Item && br1Item.buffer) {
        pdfBuffers.push(br1Item.buffer);
        addedBR1 = true;
        console.log(`[MASTER PRINT] ✅ Pedido ${order}: BR1 encontrado (Sec ${br1Item.section}, ${br1Item.controlType}, ${br1Item.providerName})`);
      } else {
        console.log(`[MASTER PRINT] ❌ Pedido ${order}: SIN BR1`);
      }

      // B. Albarán correspondiente a este pedido (Pestaña 2 primero, Flete proveedor como fallback)
      let albItem = (currentSession.userAlbaranes || []).find(a => a.extractedOrder === order);
      if (albItem && albItem.buffer) {
        pdfBuffers.push(albItem.buffer);
        addedAlbaran = true;
        albSource = 'Albaranes a Flete';
        console.log(`[MASTER PRINT] ✅ Pedido ${order}: Albarán usuario encontrado ("${albItem.filename}")`);
      } else {
        albItem = (currentSession.fleteProviderAlbaranes || []).find(p => p.extractedOrder === order);
        if (albItem && albItem.buffer) {
          pdfBuffers.push(albItem.buffer);
          addedAlbaran = true;
          albSource = 'Proveedor del Flete';
          console.log(`[MASTER PRINT] ✅ Pedido ${order}: Albarán proveedor del Flete encontrado`);
        } else {
          console.log(`[MASTER PRINT] ⚠️ Pedido ${order}: SIN ALBARÁN (ni usuario ni proveedor)`);
        }
      }

      breakdown.push({
        index: i + 1,
        order,
        br1Added: addedBR1,
        br1Details: br1Item ? `Pág ${br1Item.pageIndex} (Sec ${br1Item.section || '-'})` : 'Sin BR1',
        albaranAdded: addedAlbaran,
        albaranSource: albSource || 'Sin Albarán'
      });
    }

    if (pdfBuffers.length === 0) {
      return res.status(400).json({ error: 'No hay documentos cargados para generar la impresión unificada.' });
    }

    const masterBuffer = await mergePDFs(pdfBuffers);

    const now = new Date();
    const dateStr = now.toISOString().replace(/T/, '_').replace(/:/g, '-').slice(0, 19);
    const masterFilename = `Lote_Unificado_Impresion_${dateStr}.pdf`;
    const masterFilePath = path.join(HISTORICO_DIR, masterFilename);

    fs.writeFileSync(masterFilePath, masterBuffer);
    const masterFileUrl = `/historico/${masterFilename}`;

    currentSession.masterBuffer = masterBuffer;
    currentSession.masterFileUrl = masterFileUrl;

    res.json({
      success: true,
      masterFilename,
      masterFileUrl,
      totalOrdersSequence: sequence.length,
      totalPagesInMaster: pdfBuffers.length,
      breakdown
    });
  } catch (error) {
    console.error('Error al generar lote de impresión maestro:', error);
    res.status(500).json({ error: `Error al generar impresión: ${error.message}` });
  }
});

/**
 * Endpoint 5: Enviar Lote Maestro a la Impresora de Windows
 */
app.post('/api/print-master', async (req, res) => {
  try {
    if (!currentSession.masterBuffer) {
      return res.status(400).json({ error: 'Primero debes generar el Lote Unificado de Impresión.' });
    }

    const tempPath = path.join(UPLOADS_DIR, `spool_master_${Date.now()}.pdf`);
    fs.writeFileSync(tempPath, currentSession.masterBuffer);

    const printResult = await printPDF(tempPath, req.body.printerName);

    setTimeout(() => {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }, 15000);

    res.json({
      success: true,
      message: `Enviado Lote Unificado a la impresora mediante ${printResult.method}.`,
      details: printResult
    });
  } catch (error) {
    console.error('Error al mandar a imprimir lote maestro:', error);
    res.status(500).json({ error: `Error al enviar a la impresora: ${error.message}` });
  }
});

app.get('/api/impresoras', async (req, res) => {
  try {
    const printers = await getPrinters();
    res.json({ success: true, printers });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/historico', (req, res) => {
  try {
    const files = fs.readdirSync(HISTORICO_DIR)
      .filter(f => f.endsWith('.pdf'))
      .map(f => {
        const stats = fs.statSync(path.join(HISTORICO_DIR, f));
        return {
          filename: f,
          url: `/historico/${f}`,
          sizeBytes: stats.size,
          sizeFormatted: `${(stats.size / 1024).toFixed(1)} KB`,
          createdAt: stats.birthtime.toLocaleString('es-ES')
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    res.json({ success: true, count: files.length, files });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 PlataformaAUTO escuchando en http://0.0.0.0:${PORT}`);
  console.log(`====================================================`);
});
