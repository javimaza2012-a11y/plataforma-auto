// Global App State
let currentRecapData = null;
let currentAlbaranesData = null;
let currentBR1Data = null;

document.addEventListener('DOMContentLoaded', () => {
  setupDragAndDrop();
  setupBR1DragAndDrop();
  
  const btnHistory = document.getElementById('btn-refresh-history');
  if (btnHistory) {
    btnHistory.addEventListener('click', openHistoricoModal);
  }
});

// Navigation Tabs
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

  const activeBtn = document.getElementById(`tab-btn-${tabId}`);
  const activeContent = document.getElementById(`tab-${tabId}`);

  if (activeBtn) activeBtn.classList.add('active');
  if (activeContent) activeContent.classList.add('active');
}

// Modal Histórico
function openHistoricoModal() {
  const modal = document.getElementById('modal-historico');
  if (modal) {
    modal.classList.remove('hidden');
    loadHistorico();
  }
}

function closeHistoricoModal() {
  const modal = document.getElementById('modal-historico');
  if (modal) {
    modal.classList.add('hidden');
  }
}

// Drag & Drop Setup (Recap & Albaranes)
function setupDragAndDrop() {
  // Recapitulativo Zone
  const recapZone = document.getElementById('drop-zone-recap');
  const recapInput = document.getElementById('input-file-recap');

  recapZone.addEventListener('click', () => recapInput.click());
  recapInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) uploadRecapitulativo(e.target.files[0]);
  });

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    recapZone.addEventListener(eventName, preventDefaults, false);
  });

  ['dragenter', 'dragover'].forEach(eventName => {
    recapZone.addEventListener(eventName, () => recapZone.classList.add('dragover'), false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    recapZone.addEventListener(eventName, () => recapZone.classList.remove('dragover'), false);
  });

  recapZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) uploadRecapitulativo(files[0]);
  });

  // Albaranes Zone
  const albaranesZone = document.getElementById('drop-zone-albaranes');
  const albaranesInput = document.getElementById('input-files-albaranes');

  albaranesZone.addEventListener('click', () => albaranesInput.click());
  albaranesInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) uploadAlbaranes(Array.from(e.target.files));
  });

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    albaranesZone.addEventListener(eventName, preventDefaults, false);
  });

  ['dragenter', 'dragover'].forEach(eventName => {
    albaranesZone.addEventListener(eventName, () => albaranesZone.classList.add('dragover'), false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    albaranesZone.addEventListener(eventName, () => albaranesZone.classList.remove('dragover'), false);
  });

  albaranesZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = Array.from(dt.files);
    if (files.length > 0) uploadAlbaranes(files);
  });
}

// Drag & Drop BR1
function setupBR1DragAndDrop() {
  const br1Zone = document.getElementById('drop-zone-br1');
  const br1Input = document.getElementById('input-file-br1');

  if (!br1Zone || !br1Input) return;

  br1Zone.addEventListener('click', () => br1Input.click());
  br1Input.addEventListener('change', (e) => {
    if (e.target.files.length > 0) uploadBR1(e.target.files[0]);
  });

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    br1Zone.addEventListener(eventName, preventDefaults, false);
  });

  ['dragenter', 'dragover'].forEach(eventName => {
    br1Zone.addEventListener(eventName, () => br1Zone.classList.add('dragover'), false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    br1Zone.addEventListener(eventName, () => br1Zone.classList.remove('dragover'), false);
  });

  br1Zone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt.files.length > 0) uploadBR1(dt.files[0]);
  });
}

function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

// 1. Upload & Process Recapitulativo PDF
async function uploadRecapitulativo(file) {
  const loader = document.getElementById('loader-recap');
  const resultsDiv = document.getElementById('results-recap');
  loader.classList.remove('hidden');

  const formData = new FormData();
  formData.append('recapitulativoFile', file);

  try {
    const response = await fetch('/api/recapitulativo', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    loader.classList.add('hidden');

    if (!response.ok || !data.success) {
      showToast(data.error || 'Error al procesar recapitulativo', true);
      return;
    }

    currentRecapData = data;

    // Actualizar KPIs
    document.getElementById('kpi-total-orders').textContent = data.totalOrders;
    document.getElementById('kpi-total-pallets').textContent = data.totalSoportes || data.totalPallets;
    document.getElementById('recap-file-name').textContent = data.filename;

    // Actualizar Textarea de SAP
    document.getElementById('textarea-sap').value = data.sapCopyString;

    // Actualizar Tabla de Soportes
    const tbody = document.getElementById('tbody-pallets');
    tbody.innerHTML = '';

    if (data.orders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color: var(--text-muted);">No se detectaron pedidos en la transmisión</td></tr>`;
    } else {
      data.orders.forEach((order, index) => {
        const tr = document.createElement('tr');
        const soportesCount = order.soportes || order.pallets;
        tr.innerHTML = `
          <td>${index + 1}</td>
          <td><strong style="color:#fff;">${order.orderNumber}</strong></td>
          <td><span class="badge-sm" style="background:rgba(59,130,246,0.2); color:#93c5fd; font-weight:700;">${soportesCount} Soporte(s)</span></td>
          <td><span class="status-badge valid"><i class="fa-solid fa-check"></i> Extraído</span></td>
        `;
        tbody.appendChild(tr);
      });
    }

    resultsDiv.classList.remove('hidden');
    const totalSoportes = data.totalSoportes || data.totalPallets;
    showToast(`¡Flete procesado! ${data.totalOrders} pedidos y ${totalSoportes} soportes detectados.`);

  } catch (error) {
    loader.classList.add('hidden');
    showToast(`Error de conexión: ${error.message}`, true);
  }
}

// 2. Upload & Filter Albaranes PDFs
async function uploadAlbaranes(files) {
  const loader = document.getElementById('loader-albaranes');
  const resultsDiv = document.getElementById('results-albaranes');
  loader.classList.remove('hidden');

  const formData = new FormData();
  files.forEach(f => formData.append('albaranesFiles', f));

  try {
    const response = await fetch('/api/albaranes', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    loader.classList.add('hidden');

    if (!response.ok || !data.success) {
      showToast(data.error || 'Error al procesar albaranes', true);
      return;
    }

    currentAlbaranesData = data;

    // Actualizar Resumen y Botones
    document.getElementById('count-valid').textContent = data.totalValid;
    document.getElementById('count-discarded').textContent = data.totalDiscarded;

    const kpiPrintValid = document.getElementById('kpi-print-valid');
    if (kpiPrintValid) kpiPrintValid.textContent = data.totalValid;

    const downloadBtn = document.getElementById('link-download-merged');
    const downloadTab4Btn = document.getElementById('link-download-tab4');

    if (data.mergedFileUrl) {
      downloadBtn.href = data.mergedFileUrl;
      downloadBtn.classList.remove('hidden');
      if (downloadTab4Btn) {
        downloadTab4Btn.href = data.mergedFileUrl;
        downloadTab4Btn.classList.remove('hidden');
      }
    } else {
      downloadBtn.classList.add('hidden');
      if (downloadTab4Btn) downloadTab4Btn.classList.add('hidden');
    }

    // Rellenar Tabla de Albaranes
    const tbody = document.getElementById('tbody-albaranes');
    tbody.innerHTML = '';

    data.results.forEach(alb => {
      const tr = document.createElement('tr');
      const statusBadge = alb.isValid
        ? `<span class="status-badge valid"><i class="fa-solid fa-circle-check"></i> VÁLIDO</span>`
        : `<span class="status-badge discarded"><i class="fa-solid fa-circle-xmark"></i> DESCARTADO</span>`;

      tr.innerHTML = `
        <td>${statusBadge}</td>
        <td><i class="fa-regular fa-file-pdf" style="color:var(--accent-rose); margin-right:0.4rem;"></i> ${alb.filename}</td>
        <td><code>${alb.extractedOrder || 'N/A'}</code></td>
        <td style="color:${alb.isValid ? 'var(--text-muted)' : '#fca5a5'};">${alb.reason}</td>
      `;
      tbody.appendChild(tr);
    });

    resultsDiv.classList.remove('hidden');
    showToast(`Análisis completado: ${data.totalValid} albaranes válidos y ${data.totalDiscarded} descartados.`);

  } catch (error) {
    loader.classList.add('hidden');
    showToast(`Error al procesar albaranes: ${error.message}`, true);
  }
}

// Copiar al Portapapeles para SAP
function copySapList() {
  const textarea = document.getElementById('textarea-sap');
  if (!textarea.value) {
    showToast('No hay números de pedido para copiar', true);
    return;
  }

  textarea.select();
  document.execCommand('copy');

  showToast('¡Copiado al portapapeles! Puedes pegarlo en SAP (Ctrl + V).');
}

// Imprimir Albaranes Válidos
async function printValidBatch() {
  if (!currentAlbaranesData || !currentAlbaranesData.mergedFilename) {
    showToast('No hay albaranes válidos procesados para imprimir.', true);
    return;
  }

  const filename = currentAlbaranesData.mergedFilename;

  try {
    showToast('Enviando documento unificado a la impresora de Windows...');

    const response = await fetch('/api/imprimir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename })
    });

    const data = await response.json();

    if (response.ok && data.success) {
      showToast('🖨️ ¡Documento enviado a la impresora predeterminada!');
    } else {
      showToast(`Error al imprimir: ${data.error}`, true);
    }
  } catch (error) {
    showToast(`Error de envío a la impresora: ${error.message}`, true);
  }
}

// 3. Upload & Process BR1 PDF (Documentos de Descarga SAP)
async function uploadBR1(file) {
  const loader = document.getElementById('loader-br1');
  const resultsDiv = document.getElementById('results-br1');
  loader.classList.remove('hidden');

  const formData = new FormData();
  formData.append('br1File', file);

  try {
    const response = await fetch('/api/br1', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    loader.classList.add('hidden');

    if (!response.ok || !data.success) {
      showToast(`Error al procesar BR1: ${data.error || 'Respuesta inválida'}`, true);
      return;
    }

    currentBR1Data = data;
    renderBR1Results(data);

  } catch (error) {
    loader.classList.add('hidden');
    showToast(`Error de conexión al procesar BR1: ${error.message}`, true);
  }
}

function renderBR1Results(data) {
  document.getElementById('kpi-br1-total').textContent = data.totalExtracted || 0;
  document.getElementById('kpi-br1-direct').textContent = data.directCount || 0;
  document.getElementById('kpi-br1-conteo').textContent = data.conteoCount || 0;
  document.getElementById('br1-file-name').textContent = data.filename || 'BR1.pdf';

  const tbody = document.getElementById('tbody-br1');
  tbody.innerHTML = '';

  if (!data.items || data.items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No se detectaron registros en el documento BR1.</td></tr>`;
  } else {
    data.items.forEach((item, index) => {
      const tr = document.createElement('tr');
      const isDirect = (item.controlType === 'D');
      const controlBadge = isDirect 
        ? `<span class="badge-status valid" style="font-weight:700;"><i class="fa-solid fa-bolt"></i> D</span>`
        : `<span class="badge-sm" style="background:rgba(59,130,246,0.15); color:var(--accent-blue); font-weight:700;"><i class="fa-solid fa-list-check"></i> C</span>`;

      // Formatear la sección como 2 dígitos (ej. "03", "07", "06") o vacío/guión si no existe
      const displaySection = (item.section && item.section !== 'N/A') 
        ? `<strong style="color:var(--accent-amber); font-size:1.05rem;">${item.section.toString().replace(/[^0-9]/g, '').padStart(2, '0')}</strong>` 
        : `<span style="color:var(--text-muted);">-</span>`;

      const displayDocLast4 = (item.docNumberLast4 && item.docNumberLast4 !== 'N/A')
        ? `<span class="pill green" style="font-size:1.1rem; font-weight:700; letter-spacing:1px;">${item.docNumberLast4}</span>`
        : `<span style="color:var(--text-muted);">-</span>`;

      const displayProvider = item.providerName ? `<strong style="color:#fff;">${item.providerName}</strong>` : `<span style="color:var(--text-muted);">-</span>`;

      tr.innerHTML = `
        <td>${index + 1}</td>
        <td>${controlBadge}</td>
        <td>${displaySection}</td>
        <td>${displayDocLast4}</td>
        <td>${displayProvider}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  document.getElementById('results-br1').classList.remove('hidden');
  showToast(`✅ Procesado documento BR1: ${data.totalExtracted} registros extraídos.`);
}

// Cargar Histórico de Lotes Guardados
async function loadHistorico() {
  const tbody = document.getElementById('tbody-historico');
  tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">Cargando histórico...</td></tr>`;

  try {
    const response = await fetch('/api/historico');
    const data = await response.json();

    if (!response.ok || !data.success) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--accent-rose);">Error al cargar histórico</td></tr>`;
      return;
    }

    tbody.innerHTML = '';

    if (data.files.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">Aún no hay PDFs unificados guardados en el histórico.</td></tr>`;
      return;
    }

    data.files.forEach(file => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><i class="fa-solid fa-calendar-day" style="color:var(--accent-blue); margin-right:0.4rem;"></i> ${file.createdAt}</td>
        <td><strong>${file.filename}</strong></td>
        <td><span class="badge-sm">${file.sizeFormatted}</span></td>
        <td>
          <a href="${file.url}" target="_blank" class="btn btn-secondary btn-sm"><i class="fa-solid fa-eye"></i> Ver PDF</a>
          <button class="btn btn-emerald btn-sm" onclick="printHistoricalFile('${file.filename}')"><i class="fa-solid fa-print"></i> Imprimir</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--accent-rose);">Error de conexión</td></tr>`;
  }
}

async function printHistoricalFile(filename) {
  try {
    showToast(`Imprimiendo archivo del histórico ${filename}...`);
    const response = await fetch('/api/imprimir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename })
    });
    const data = await response.json();
    if (response.ok && data.success) {
      showToast('🖨️ Archivo enviado a la impresora correctamente.');
    } else {
      showToast(`Error al imprimir: ${data.error}`, true);
    }
  } catch (e) {
    showToast(`Error: ${e.message}`, true);
  }
}

// Toast Notifications
function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-message');
  const toastIcon = toast.querySelector('.toast-icon');

  toastMsg.textContent = message;

  if (isError) {
    toast.style.borderColor = 'var(--accent-rose)';
    toastIcon.className = 'fa-solid fa-circle-exclamation toast-icon';
    toastIcon.style.color = 'var(--accent-rose)';
  } else {
    toast.style.borderColor = 'var(--accent-emerald)';
    toastIcon.className = 'fa-solid fa-circle-check toast-icon';
    toastIcon.style.color = 'var(--accent-emerald)';
  }

  toast.classList.remove('hidden');

  setTimeout(() => {
    toast.classList.add('hidden');
  }, 4000);
}

// 4. Generar Lote Unificado de Impresión Maestro (Pestaña 4)
async function generateMasterPrint() {
  const loader = document.getElementById('loader-master');
  const resultsDiv = document.getElementById('results-master');
  const btnPrint = document.getElementById('btn-print-master');
  const downloadTab4 = document.getElementById('link-download-tab4');
  const tbody = document.getElementById('tbody-master-breakdown');

  if (loader) loader.classList.remove('hidden');

  try {
    const response = await fetch('/api/generate-master-print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await response.json();
    if (loader) loader.classList.add('hidden');

    if (!response.ok || !data.success) {
      showToast(data.error || 'Error al generar lote maestro', true);
      return;
    }

    if (downloadTab4 && data.masterFileUrl) {
      downloadTab4.href = data.masterFileUrl;
      downloadTab4.classList.remove('hidden');
    }
    if (btnPrint) btnPrint.classList.remove('hidden');

    if (tbody && data.breakdown) {
      tbody.innerHTML = '';
      data.breakdown.forEach(row => {
        const tr = document.createElement('tr');
        if (row.section === 'INICIO') {
          tr.innerHTML = `
            <td><span class="badge-status valid"><i class="fa-solid fa-flag-checkered"></i> INICIO</span></td>
            <td colspan="4"><strong>${row.title}</strong></td>
          `;
        } else {
          const br1Status = row.br1Added 
            ? `<span class="badge-status valid"><i class="fa-solid fa-check"></i> ${row.br1Details}</span>`
            : `<span class="badge-status discarded">Sin BR1</span>`;

          const albStatus = row.albaranAdded
            ? `<span class="pill green"><i class="fa-solid fa-check"></i> Adjuntado</span>`
            : `<span class="badge-status discarded">Sin Albarán</span>`;

          tr.innerHTML = `
            <td>${row.index}</td>
            <td><code>${row.order}</code></td>
            <td>${br1Status}</td>
            <td>${albStatus}</td>
            <td><strong>${row.albaranSource}</strong></td>
          `;
        }
        tbody.appendChild(tr);
      });
    }

    if (resultsDiv) resultsDiv.classList.remove('hidden');
    showToast(`✅ Generado Lote Unificado Maestro: ${data.totalOrdersSequence} pedidos ordenados.`);
  } catch (err) {
    if (loader) loader.classList.add('hidden');
    showToast(`Error de conexión: ${err.message}`, true);
  }
}

async function printMasterBatch() {
  try {
    showToast('🖨️ Enviando Lote Unificado Maestro a la impresora...');
    const response = await fetch('/api/print-master', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await response.json();
    if (response.ok && data.success) {
      showToast('✅ Impresión del Lote Unificado iniciada con éxito.');
    } else {
      showToast(data.error || 'Error al mandar a imprimir', true);
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, true);
  }
}
