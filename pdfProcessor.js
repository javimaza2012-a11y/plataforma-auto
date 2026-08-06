const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { createWorker } = require('tesseract.js');


let mupdfModule = null;
async function getMupdf() {
  if (!mupdfModule) {
    mupdfModule = await import('mupdf');
  }
  return mupdfModule;
}

/**
 * Extractor OCR de Alta Definición (PSM 6 + Escala 2.5x + MuPDF + Tesseract.js).
 * Especializado para tablas de transmisiones escaneadas de DKV Madrid.
 */
async function processScannedPdfPages(pdfBuffer) {
  const mupdf = await getMupdf();
  const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
  const pageCount = doc.countPages();

  const worker = await createWorker('spa');
  
  // Configurar modo de segmentación de páginas 6 (bloque uniforme de texto/tabla) para máxima precisión
  await worker.setParameters({
    tessedit_pageseg_mode: '6',
  });

  let fullExtractedText = '';
  let reachedEndOfReport = false;

  for (let i = 0; i < pageCount; i++) {
    if (reachedEndOfReport) break;

    const page = doc.loadPage(i);
    
    // Escala 2.5x + Rotación 180º (formato estándar de las transmisiones escaneadas DKV)
    const matrix180 = mupdf.Matrix.scale(-2.5, -2.5);
    const pixmap180 = page.toPixmap(matrix180, mupdf.ColorSpace.DeviceRGB, false, true);
    const pngBuffer180 = Buffer.from(pixmap180.asPNG());
    
    const res180 = await worker.recognize(pngBuffer180);
    let pageText = res180.data.text || '';

    // Si la orientación rotada no devuelve palabras clave de recapitulativo, probar orientación normal 2.5x
    if (!pageText.includes('RECAPITULATIVO') && !pageText.includes('EXPEDICION') && !pageText.includes('PEDIDO') && !pageText.includes('PEDCLIENT') && !pageText.includes('END OF REPORT')) {
      const matrixNormal = mupdf.Matrix.scale(2.5, 2.5);
      const pixmapNormal = page.toPixmap(matrixNormal, mupdf.ColorSpace.DeviceRGB, false, true);
      const pngBufferNormal = Buffer.from(pixmapNormal.asPNG());
      const resNormal = await worker.recognize(pngBufferNormal);
      
      if (resNormal.data.text.includes('RECAPITULATIVO') || resNormal.data.text.includes('EXPEDICION') || resNormal.data.text.includes('PEDIDO') || resNormal.data.text.includes('END OF REPORT')) {
        pageText = resNormal.data.text;
      }
    }

    fullExtractedText += `\n--- PÁGINA ${i + 1} ---\n` + pageText;

    const normalizedPageText = pageText.toUpperCase().replace(/\s+/g, ' ');
    if (normalizedPageText.includes('END OF REPORT') || normalizedPageText.includes('END OFREPORT') || normalizedPageText.includes('FIN DE INFORME')) {
      console.log(`[OCR] Detectada marca '*** END OF REPORT ***' en la Página ${i + 1}. Deteniendo procesamiento de páginas siguientes.`);
      reachedEndOfReport = true;
    }
  }

  await worker.terminate();
  return fullExtractedText;
}

/**
 * Extrae y agrupa las páginas de albaranes de proveedor (tras *** END OF REPORT ***).
 * Agrupa páginas consecutivas que pertenecen al mismo pedido / proveedor en un único PDF multipágina.
 */
async function extractAndGroupProviderAlbaranes(pdfBuffer, endOfReportPageIndex, totalPageCount) {
  const providerDocs = [];
  if (endOfReportPageIndex < 0 || endOfReportPageIndex + 1 >= totalPageCount) {
    return providerDocs;
  }

  console.log(`[RECAP PROVEEDOR] Analizando y agrupando páginas ${endOfReportPageIndex + 2} a ${totalPageCount}...`);
  const srcDoc = await PDFDocument.load(pdfBuffer);

  let currentGroup = null;

  for (let pIdx = endOfReportPageIndex + 1; pIdx < totalPageCount; pIdx++) {
    // 1. Extraer buffer de 1 página para OCR
    const singleDoc = await PDFDocument.create();
    const [copiedPage] = await singleDoc.copyPages(srcDoc, [pIdx]);
    singleDoc.addPage(copiedPage);
    const singleBuf = Buffer.from(await singleDoc.save());

    // 2. Extraer texto OCR de la página
    let pageText = '';
    try {
      pageText = await ocrAlbaranDualOrientation(singleBuf);
    } catch (e) {
      pageText = '';
    }

    // 3. Extraer pedido y detectar posible cabecera/proveedor
    let pageOrder = 'N/A';
    const orderMatch = pageText.match(/\b(180[0-9]{7}|176[0-9]{7})\b/);
    if (orderMatch) {
      pageOrder = orderMatch[1];
    }

    const textUpper = pageText.toUpperCase();
    const isExplicitPage1 = /\b(PAGINA|PAG|HOJA)\s*1\b/.test(textUpper) || /\b1\s*\/\s*\d+\b/.test(textUpper);

    // 4. Determinar si esta página inicia un nuevo albarán de proveedor o continúa el actual
    const isNewDoc = !currentGroup || 
                     (pageOrder !== 'N/A' && currentGroup.extractedOrder !== 'N/A' && pageOrder !== currentGroup.extractedOrder) ||
                     (isExplicitPage1 && currentGroup.pages.length > 0);

    if (isNewDoc) {
      if (currentGroup) {
        providerDocs.push(currentGroup);
      }
      currentGroup = {
        docIndex: providerDocs.length + 1,
        extractedOrder: pageOrder,
        pages: [pIdx],
        pageCount: 1
      };
      console.log(`[RECAP PROVEEDOR] 📄 Inicio de documento #${currentGroup.docIndex} en Página ${pIdx + 1} -> Pedido: ${pageOrder}`);
    } else {
      currentGroup.pages.push(pIdx);
      currentGroup.pageCount++;
      if (currentGroup.extractedOrder === 'N/A' && pageOrder !== 'N/A') {
        currentGroup.extractedOrder = pageOrder;
      }
      console.log(`[RECAP PROVEEDOR] 📑 Añadida Página ${pIdx + 1} al documento #${currentGroup.docIndex} -> Pedido: ${currentGroup.extractedOrder}`);
    }
  }

  if (currentGroup) {
    providerDocs.push(currentGroup);
  }

  // 5. Generar los buffers PDF multipágina finales para cada documento de proveedor agrupado
  const resultProviderAlbaranes = [];
  for (const group of providerDocs) {
    const multiDoc = await PDFDocument.create();
    const copied = await multiDoc.copyPages(srcDoc, group.pages);
    copied.forEach(p => multiDoc.addPage(p));
    const multiBuf = Buffer.from(await multiDoc.save());

    const pageStr = group.pages.map(p => p + 1).join('-');
    const filename = `Proveedor_Recap_Doc_${group.docIndex}_Pags_${pageStr}.pdf`;

    resultProviderAlbaranes.push({
      filename,
      buffer: multiBuf,
      isValid: true,
      status: 'VÁLIDO (PROVEEDOR)',
      reason: `Albarán de proveedor (${group.pageCount} pág${group.pageCount > 1 ? 's' : ''})`,
      extractedOrder: group.extractedOrder,
      isProvider: true,
      pageCount: group.pageCount
    });
  }

  return resultProviderAlbaranes;
}

/**
 * Parsea el PDF del Recapitulativo DKV.
 * Extrae los pedidos de cliente hasta encontrar *** END OF REPORT ***, calcula los palés,
 * y extrae las páginas de proveedor que vienen a continuación del informe.
 */
async function parseRecapitulativo(pdfBuffer) {
  console.log('Iniciando procesamiento OCR de alta definición (2.5x PSM6) del recapitulativo DKV...');
  
  const mupdf = await getMupdf();
  const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
  const pageCount = doc.countPages();

  const worker = await createWorker('spa');
  await worker.setParameters({ tessedit_pageseg_mode: '6' });

  let fullExtractedText = '';
  let endOfReportPageIndex = -1;
  const recapBboxesByPage = {};

  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i);
    
    // Escala 3.0x + Rotación 180º (formato estándar de las transmisiones escaneadas DKV)
    const matrix180 = mupdf.Matrix.scale(-3.0, -3.0);
    const pixmap180 = page.toPixmap(matrix180, mupdf.ColorSpace.DeviceRGB, false, true);
    const pngBuffer180 = Buffer.from(pixmap180.asPNG());
    
    const res180 = await worker.recognize(pngBuffer180, {}, { hocr: true });
    let pageText = res180.data.text || '';
    let pageHocr = res180.data.hocr || '';
    let usedAngle = 180;

    // Si la orientación rotada no devuelve palabras clave de recapitulativo, probar orientación normal 3.0x
    if (!pageText.includes('RECAPITULATIVO') && !pageText.includes('EXPEDICION') && !pageText.includes('PEDIDO') && !pageText.includes('PEDCLIENT') && !pageText.includes('END OF REPORT')) {
      const matrixNormal = mupdf.Matrix.scale(3.0, 3.0);
      const pixmapNormal = page.toPixmap(matrixNormal, mupdf.ColorSpace.DeviceRGB, false, true);
      const pngBufferNormal = Buffer.from(pixmapNormal.asPNG());
      const resNormal = await worker.recognize(pngBufferNormal, {}, { hocr: true });
      
      if (resNormal.data.text.includes('RECAPITULATIVO') || resNormal.data.text.includes('EXPEDICION') || resNormal.data.text.includes('PEDIDO') || resNormal.data.text.includes('END OF REPORT')) {
        pageText = resNormal.data.text;
        pageHocr = resNormal.data.hocr || '';
        usedAngle = 0;
      }
    }

    // Extraer bounding boxes de las líneas que contienen pedidos
    const orderBboxes = {};
    const linesHtml = pageHocr.split("<span class='ocr_line'");
    for (const lineHtml of linesHtml.slice(1)) {
      const bboxMatch = lineHtml.match(/title=["']bbox (\d+) (\d+) (\d+) (\d+)/);
      if (!bboxMatch) continue;
      const [, x0, y0, x1, y1] = bboxMatch;
      const textClean = lineHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const orderMatch = textClean.match(/\b(180[0-9]{7}|176[0-9]{7})\b/);
      if (orderMatch) {
        const order = orderMatch[1];
        const py0 = parseInt(y0, 10) / 3.0;
        const py1 = parseInt(y1, 10) / 3.0;
        if (!orderBboxes[order]) {
          orderBboxes[order] = { minY: py0, maxY: py1, text: textClean, angle: usedAngle };
        } else {
          orderBboxes[order].minY = Math.min(orderBboxes[order].minY, py0);
          orderBboxes[order].maxY = Math.max(orderBboxes[order].maxY, py1);
        }
      }
    }
    recapBboxesByPage[i] = orderBboxes;

    fullExtractedText += `\n--- PÁGINA ${i + 1} ---\n` + pageText;

    const normalizedPageText = pageText.toUpperCase().replace(/\s+/g, ' ');
    if (normalizedPageText.includes('END OF REPORT') || normalizedPageText.includes('END OFREPORT') || normalizedPageText.includes('FIN DE INFORME')) {
      console.log(`[OCR] Detectada marca '*** END OF REPORT ***' en la Página ${i + 1}. Finalizando OCR del recapitulativo.`);
      endOfReportPageIndex = i;
      break;
    }
  }

  await worker.terminate();
  
  const lines = fullExtractedText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  
  const ordersMap = new Map(); // orderNumber -> { orderNumber, soportesSet: Set, countTotal: number|null, rawLines: [] }
  const rawOrdersList = [];
  let currentOrder = null;
  let detectedGrandTotal = null;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const lineUpper = line.toUpperCase().replace(/\s+/g, ' ');
    
    if (lineUpper.includes('END OF REPORT') || lineUpper.includes('END OFREPORT') || lineUpper.includes('FIN DE INFORME')) {
      console.log("[PARSER] Alcanzada la marca '*** END OF REPORT ***'. Finalizando recolección de pedidos.");
      break;
    }

    if (lineUpper.includes('RECAPITULATIVO') || lineUpper.includes('EXPEDICION CLIENTE')) {
      continue;
    }

    // A. Extraer número de pedido cliente de 10 dígitos (comenzando por 180 o 176)
    const orderMatch = line.match(/\b(180[0-9]{7}|176[0-9]{7})\b/);
    if (orderMatch) {
      const cleanOrder = orderMatch[1];
      currentOrder = cleanOrder;
      
      // Buscar el identificador de soporte de esa línea (columna SOPORTE, ej: 26,432,185 o 26,435,565)
      const soporteMatch = line.match(/\b(26[,\.]?[0-9]{3}[,\.]?[0-9]{3}|36[,\.]?[0-9]{3}[,\.]?[0-9]{3})\b/);
      const soporteId = soporteMatch ? soporteMatch[1].replace(/[^0-9]/g, '') : `line_${idx}`;

      if (!ordersMap.has(cleanOrder)) {
        ordersMap.set(cleanOrder, {
          orderNumber: cleanOrder,
          soportesSet: new Set([soporteId]),
          countTotal: null,
          rawLines: [line]
        });
        rawOrdersList.push(cleanOrder);
      } else {
        const item = ordersMap.get(cleanOrder);
        item.soportesSet.add(soporteId);
        item.rawLines.push(line);
      }
    }

    // B. Capturar valor 'COUNT N'
    const countMatch = lineUpper.match(/COUNT\s*([0-9]{1,2})\b/);
    if (countMatch) {
      const countVal = parseInt(countMatch[1], 10);

      let isGrandTotalLine = false;
      for (let nextIdx = idx + 1; nextIdx < Math.min(idx + 4, lines.length); nextIdx++) {
        if (lines[nextIdx].toUpperCase().includes('END OF REPORT')) {
          isGrandTotalLine = true;
          break;
        }
      }

      if (isGrandTotalLine) {
        detectedGrandTotal = countVal;
      } else if (currentOrder) {
        const item = ordersMap.get(currentOrder);
        if (item && item.countTotal === null) {
          item.countTotal = countVal;
        }
      }
    }
  }

  const ordersArray = rawOrdersList.map(num => {
    const item = ordersMap.get(num);
    const count = item.countTotal || item.soportesSet.size;
    return {
      orderNumber: item.orderNumber,
      soportes: count,
      pallets: count,
      rawLines: item.rawLines
    };
  });
  const totalSoportes = detectedGrandTotal || ordersArray.reduce((acc, curr) => acc + curr.soportes, 0);

  // Extraer buffer PDF de la cabecera del Flete (Carta de porte + Recapitulativo hasta *** END OF REPORT ***)
  let fleteHeaderBuffer = null;
  if (endOfReportPageIndex >= 0) {
    try {
      const srcDoc = await PDFDocument.load(pdfBuffer);
      const headerDoc = await PDFDocument.create();
      const pageIndices = [];
      for (let hIdx = 0; hIdx <= endOfReportPageIndex; hIdx++) {
        pageIndices.push(hIdx);
      }
      const copiedPages = await headerDoc.copyPages(srcDoc, pageIndices);
      copiedPages.forEach(p => headerDoc.addPage(p));
      fleteHeaderBuffer = Buffer.from(await headerDoc.save());
    } catch (err) {
      console.error('Error al aislar cabecera del Flete:', err);
    }
  }

  // Extraer y agrupar las páginas de albaranes de proveedor (después de *** END OF REPORT ***)
  const providerAlbaranes = await extractAndGroupProviderAlbaranes(pdfBuffer, endOfReportPageIndex, pageCount);

  return {
    success: true,
    totalOrders: ordersArray.length,
    totalSoportes: totalSoportes,
    totalPallets: totalSoportes,
    orders: ordersArray,
    ordersSequence: rawOrdersList,
    providerAlbaranes: providerAlbaranes,
    fleteHeaderBuffer: fleteHeaderBuffer,
    recapBboxesByPage: recapBboxesByPage,
    sapCopyString: ordersArray.map(o => o.orderNumber).join('\n'),
    fullTextPreview: fullExtractedText.substring(0, 2000)
  };
}

/**
 * Procesa OCR de un albarán probando las 4 orientaciones (0°, 90°, 180°, 270°).
 * Devuelve el texto de la orientación con mayor presencia de palabras clave de albaranes/pedidos.
 */
async function ocrAlbaranDualOrientation(pdfBuffer) {
  const mupdf = await getMupdf();
  const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
  const page = doc.loadPage(0);

  const worker = await createWorker('spa');
  await worker.setParameters({ tessedit_pageseg_mode: '6' });

  const angles = [0, 90, 180, 270];
  let bestText = '';
  let maxScore = -1;
  let bestAngle = 0;

  const spanishKeywords = /albaran|pedido|descripcion|seccion|articulo|cantidad|unidad|expedicion|referencia|cliente|ean|total|fecha|pagina|obramat|sesta|tubo|plasticos|puertas|molecor|codeba|sanelec|futurbano/gi;
  const orderNumberPattern = /\b(180[0-9]{7}|176[0-9]{7})\b/;

  for (const deg of angles) {
    const matScale = mupdf.Matrix.scale(2.5, 2.5);
    const matRot = mupdf.Matrix.rotate(deg);
    const matrix = mupdf.Matrix.concat(matScale, matRot);

    const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
    const res = await worker.recognize(Buffer.from(pixmap.asPNG()));
    const text = res.data.text || '';

    let score = (text.match(spanishKeywords) || []).length;
    if (orderNumberPattern.test(text)) {
      score += 10;
    }

    if (score > maxScore) {
      maxScore = score;
      bestText = text;
      bestAngle = deg;
    }
  }

  await worker.terminate();
  console.log(`[OCR-ALBARAN Quad] Ángulo óptimo: ${bestAngle}° con ${maxScore} puntos.`);
  return bestText;
}

/**
 * Analiza un PDF de Albarán individual.
 * Descarta albaranes que contengan artículos "Sin Descripcion" / "Sin EAN".
 */
async function parseAlbaran(pdfBuffer, filename) {
  try {
    let text = '';
    try {
      text = await ocrAlbaranDualOrientation(pdfBuffer);
    } catch (e) {
      console.error(`[ALBARAN] Error OCR para "${filename}":`, e.message);
      text = '';
    }

    console.log(`[ALBARAN] === Texto OCR de "${filename}" (primeros 800 chars) ===`);
    console.log(text.substring(0, 800));

    const textUpper = text.toUpperCase();
    const normalizedText = textUpper.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // 1. Intentar extraer el nº de pedido del nombre de archivo (patrón típico DKV)
    let extractedOrder = 'N/A';

    const filenameOrderMatch = filename.match(/(180[0-9]{7}|176[0-9]{7})/);
    if (filenameOrderMatch) {
      extractedOrder = filenameOrderMatch[1];
    }

    // Si no se encontró en el nombre, buscar en el texto OCR
    if (extractedOrder === 'N/A') {
      const textOrderMatch = text.match(/\b(180[0-9]{7}|176[0-9]{7})\b/);
      if (textOrderMatch) {
        extractedOrder = textOrderMatch[1];
      }
    }

    // 2. Comprobar si contiene "Sin Descripcion" o "Sin EAN" explícitamente
    const containsSinDescripcion = normalizedText.includes('SIN DESCRIPCION') || 
                                    normalizedText.includes('S/DESCRIPCION');

    const containsSinEAN = normalizedText.includes('SIN EAN') ||
                           normalizedText.includes('S/EAN');

    if (containsSinDescripcion || containsSinEAN) {
      const reasons = [];
      if (containsSinDescripcion) reasons.push('"Sin Descripcion"');
      if (containsSinEAN) reasons.push('"Sin EAN"');
      
      console.log(`[ALBARAN] ❌ DESCARTADO "${filename}" → ${reasons.join(' y ')}`);
      return {
        filename,
        isValid: false,
        status: 'DESCARTADO',
        reason: `Contiene ${reasons.join(' y ')} en los artículos`,
        extractedOrder,
        textPreview: text.substring(0, 500)
      };
    }

    // 3. Comprobar si tiene líneas de artículos reales (EAN + descripción de producto)
    //    Los albaranes válidos tienen líneas tipo: "10037104 | TUBO RIGIDO PVC ... 8248601889..."
    //    Los inválidos tienen "Seccion: Sin Seccion" y NO tienen estas líneas de producto
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    
    // Buscar líneas que contengan un código de artículo seguido de un nombre de producto
    const productLinePattern = /\d{7,8}\s*[\|¦]\s*\S+/; // código de 7-8 dígitos + separador + texto
    const hasProductLines = lines.some(line => productLinePattern.test(line));

    // También verificar si la sección es "Sin Seccion" (indicador de albarán vacío)
    const hasSinSeccion = normalizedText.includes('SIN SECCION');

    if (!hasProductLines) {
      console.log(`[ALBARAN] ❌ DESCARTADO "${filename}" → Sin líneas de artículos (Sin Seccion: ${hasSinSeccion})`);
      return {
        filename,
        isValid: false,
        status: 'DESCARTADO',
        reason: 'Albarán sin artículos (Sin Descripcion / Sin EAN)',
        extractedOrder,
        textPreview: text.substring(0, 500)
      };
    }

    console.log(`[ALBARAN] ✅ VÁLIDO "${filename}" → Pedido: ${extractedOrder}`);
    return {
      filename,
      isValid: true,
      status: 'VÁLIDO',
      reason: 'Albarán correcto con detalle de artículos',
      extractedOrder,
      textPreview: text.substring(0, 500)
    };
  } catch (error) {
    return {
      filename,
      isValid: false,
      status: 'ERROR',
      reason: `Error al leer PDF: ${error.message}`,
      extractedOrder: 'N/A'
    };
  }
}

/**
 * Parsea el PDF del documento de descarga SAP (BR1).
 * Procesa TODAS las páginas del PDF.
 * Extrae:
 *   - Tipo de Control: 'D' (Directo) o 'C' (Conteo)
 *   - Sección: '01' a '09' (ej: '03', '02', '07', '06', '01' - NUNCA fallbacks arbitrarios como 05)
 *   - Últimos 4 dígitos del número de pedido de 10 dígitos arriba del código de barras (ej: 1805045530 -> 5530, 1805086582 -> 6582)
 *   - Nombre del Proveedor (ej: PUERTAS PROMA SA, PLASTICOS REVI TUBO S, MOLECOR CANALIZACIO, CODEBA SL, SANELEC LOGISTICA SL, FUTURBANO SL, AZUQUECA)
 */
async function parseBR1(pdfBuffer, filename) {
  try {
    console.log(`[BR1] Procesando PDF BR1 "${filename}"...`);
    const extractedItems = [];

    const mupdf = await getMupdf();
    const doc = mupdf.Document.openDocument(pdfBuffer, 'application/pdf');
    const pageCount = doc.countPages();
    const srcDoc = await PDFDocument.load(pdfBuffer);

    for (let pageIdx = 0; pageIdx < pageCount; pageIdx++) {
      const page = doc.loadPage(pageIdx);
      let pText = '';
      try {
        pText = page.toStructuredText().asText() || '';
      } catch (e) {
        pText = '';
      }

      // 1. Número de Pedido de 10 dígitos arriba del código de barras
      const poMatch = pText.match(/(?:PO|PEDIDO|COMPRAS)?\s*\n?\s*(180[0-9]{7}|176[0-9]{7}|45[0-9]{8}|46[0-9]{8}|[0-9]{10})/i);
      const docNumberFull = poMatch ? poMatch[1] : '';
      const docNumberLast4 = docNumberFull ? docNumberFull.slice(-4) : '';

      // 2. Control, Sección, Código de Proveedor y Nombre de Proveedor
      const detailMatch = pText.match(/([DC])\s*(0[1-9])\s*([A-Z0-9]{4,5})\s*([^\n\r]+)/);
      let controlType = 'D', section = '', providerName = '';
      if (detailMatch) {
        controlType = detailMatch[1];
        section = detailMatch[2];
        providerName = detailMatch[4].trim();
        if (providerName.includes('ZUQUECA')) providerName = 'AZUQUECA';
      }

      // Extraer buffer de página individual para el montaje maestro
      let singleBuf = null;
      try {
        const singleDoc = await PDFDocument.create();
        const [cp] = await singleDoc.copyPages(srcDoc, [pageIdx]);
        singleDoc.addPage(cp);
        singleBuf = Buffer.from(await singleDoc.save());
      } catch (err) {
        console.error(`Error extrayendo buffer de página BR1 ${pageIdx + 1}:`, err);
      }

      extractedItems.push({
        pageIndex: pageIdx + 1,
        controlType,
        controlLabel: controlType === 'C' ? 'C' : 'D',
        section,
        docNumberFull,
        docNumberLast4,
        providerName,
        buffer: singleBuf,
        rawLine: pText.substring(0, 300)
      });
    }

    return {
      success: true,
      filename,
      totalExtracted: extractedItems.length,
      directCount: extractedItems.filter(i => i.controlType === 'D').length,
      conteoCount: extractedItems.filter(i => i.controlType === 'C').length,
      items: extractedItems,
      textPreview: extractedItems.map(i => `Pág ${i.pageIndex}: Control ${i.controlType}, Sec ${i.section}, Doc ${i.docNumberLast4}, Prov ${i.providerName}`).join('\n')
    };
  } catch (error) {
    console.error('Error al procesar BR1:', error);
    return {
      success: false,
      filename,
      error: error.message
    };
  }
}

/**
 * Combina múltiples buffers de PDF en un único PDF final.
 */
async function mergePDFs(pdfBuffers) {
  const mergedPdf = await PDFDocument.create();
  
  for (const buffer of pdfBuffers) {
    const pdf = await PDFDocument.load(buffer);
    const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }
  
  const mergedBytes = await mergedPdf.save();
  return Buffer.from(mergedBytes);
}

/**
 * Anota el PDF del recapitulativo con la información de control y sección (obtenida de BR1).
 */
async function annotateRecapitulativo(fleteBuffer, recapBboxesByPage, br1Items) {
  const { rgb, degrees, StandardFonts } = require('pdf-lib');
  const pdfDoc = await PDFDocument.load(fleteBuffer);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pages = pdfDoc.getPages();

  // Crear mapa de información BR1 por pedido
  const br1Map = new Map();
  if (br1Items && br1Items.length > 0) {
    for (const item of br1Items) {
      if (item.docNumberFull) {
        br1Map.set(item.docNumberFull, item);
      }
    }
  }

  for (let i = 0; i < pages.length; i++) {
    const pdfPage = pages[i];
    const bboxes = recapBboxesByPage[i];
    if (!bboxes) continue;

    const width = pdfPage.getWidth();

    for (const [order, bbox] of Object.entries(bboxes)) {
      const yCenterImage = (bbox.minY + bbox.maxY) / 2;
      
      const br1Data = br1Map.get(order);
      const cType = br1Data ? (br1Data.controlType === 'C' ? 'C' : 'D') : 'D';
      let section = br1Data && br1Data.section ? br1Data.section : '  ';
      if (section.length === 1) section = '0' + section;
      const orderLast4 = order.slice(-4);
      
      const labelText = `${cType}   ${section}   ${orderLast4}`;

      // Posicionamiento preciso a la derecha de la columna de PESO:
      // En vista derecha (rot 180), la columna de peso está a X_view ~ 730 pt.
      // x_pdf = width - 740 = 101.92 pt
      // y_pdf = yCenterImage
      const xPdf = width - 740;
      const yPdf = yCenterImage;

      pdfPage.drawRectangle({
        x: xPdf,
        y: yPdf + 8,
        width: 85,
        height: 15,
        color: rgb(1, 0.95, 0.75),
        borderColor: rgb(0, 0.35, 0.8),
        borderWidth: 1.5,
        rotate: degrees(180)
      });

      pdfPage.drawText(labelText, {
        x: xPdf - 4,
        y: yPdf + 4,
        size: 10,
        font: font,
        color: rgb(0, 0.2, 0.7),
        rotate: degrees(180)
      });
    }
  }

  const modifiedBytes = await pdfDoc.save();
  return Buffer.from(modifiedBytes);
}

module.exports = {
  parseRecapitulativo,
  parseAlbaran,
  parseBR1,
  mergePDFs,
  annotateRecapitulativo
};
