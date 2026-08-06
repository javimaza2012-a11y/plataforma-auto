const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

let pdfToPrinter;
try {
  pdfToPrinter = require('pdf-to-printer');
} catch (e) {
  pdfToPrinter = null;
}

/**
 * Envía un archivo PDF a la impresora predeterminada de Windows.
 */
async function printPDF(filePath, printerName = null) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`El archivo no existe: ${filePath}`);
  }

  // Intentar usar pdf-to-printer primero
  if (pdfToPrinter) {
    try {
      const options = {};
      if (printerName) options.printer = printerName;
      await pdfToPrinter.print(filePath, options);
      return { success: true, method: 'pdf-to-printer' };
    } catch (err) {
      console.warn('pdf-to-printer falló, usando PowerShell fallback:', err.message);
    }
  }

  // Fallback con PowerShell nativo de Windows
  return new Promise((resolve, reject) => {
    const absolutePath = path.resolve(filePath).replace(/'/g, "''");
    let cmd = `powershell -Command "Start-Process -FilePath '${absolutePath}' -Verb Print"`;
    if (printerName) {
      cmd = `powershell -Command "$p = Get-WmiObject -Class Win32_Printer | Where-Object {$_.Name -eq '${printerName}'}; $p.SetDefaultPrinter(); Start-Process -FilePath '${absolutePath}' -Verb Print"`;
    }

    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(`Error al enviar a impresora via PowerShell: ${error.message}`));
      }
      resolve({ success: true, method: 'powershell', stdout });
    });
  });
}

/**
 * Obtener lista de impresoras disponibles en Windows.
 */
async function getPrinters() {
  if (pdfToPrinter && pdfToPrinter.getPrinters) {
    try {
      const list = await pdfToPrinter.getPrinters();
      return list;
    } catch (e) {
      // ignore
    }
  }

  return new Promise((resolve) => {
    const cmd = `powershell -Command "Get-WmiObject -Class Win32_Printer | Select-Object Name, IsDefault | ConvertTo-Json"`;
    exec(cmd, (error, stdout) => {
      if (error || !stdout) {
        return resolve([]);
      }
      try {
        const parsed = JSON.parse(stdout);
        const printers = Array.isArray(parsed) ? parsed : [parsed];
        resolve(printers.map(p => ({ name: p.Name, isDefault: p.IsDefault })));
      } catch (e) {
        resolve([]);
      }
    });
  });
}

module.exports = {
  printPDF,
  getPrinters
};
