/**
 * pdf.js — Genera PDFs empresariales reales (sección 40), no capturas
 * de pantalla. Usa jsPDF cargado por CDN (ver <script> en index.html).
 * Requiere que window.jspdf exista; si no, informa el error en vez de
 * fallar en silencio.
 */
import { obtenerConfiguracionEmpresa, obtenerIdentidadDesarrollador } from "./modules/configuracion.js";
import { formatoMoneda, formatoFecha } from "./utils.js";

function jsPDFDisponible() {
  return typeof window !== "undefined" && window.jspdf && window.jspdf.jsPDF;
}

async function cargarImagenComoDataURL(url) {
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    return await new Promise((resolve, reject) => {
      const lector = new FileReader();
      lector.onload = () => resolve(lector.result);
      lector.onerror = reject;
      lector.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn("No se pudo cargar el logo para el PDF:", err);
    return null;
  }
}

/**
 * @param {Object} documento  cotización u orden (con folio, conceptos, totales...)
 * @param {'cotizacion'|'orden'} tipo
 * @returns {Promise<{ok:boolean, blob?:Blob, filename?:string, error?:string}>}
 */
export async function generarPDF(documento, tipo) {
  if (!jsPDFDisponible()) {
    return {
      ok: false,
      error:
        "El generador de PDF (jsPDF) no cargó. Verifica tu conexión a internet — se carga desde un CDN — e inténtalo de nuevo.",
    };
  }

  const empresa = await obtenerConfiguracionEmpresa();
  const nexora = obtenerIdentidadDesarrollador();
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "mm", format: "letter" });
  const margenX = 15;
  let y = 18;

  // --- Encabezado con logo ---
  const logoDataUrl = await cargarImagenComoDataURL(empresa.logoUrl || "assets/logos/reset-alarmas-gps.jpg");
  if (logoDataUrl) {
    try {
      pdf.addImage(logoDataUrl, "JPEG", margenX, y - 6, 45, 18);
    } catch (e) {
      console.warn("No se pudo insertar el logo en el PDF:", e);
    }
  }

  pdf.setFontSize(16);
  pdf.setFont("helvetica", "bold");
  pdf.text(empresa.nombreComercial || "ALARMAS Y GPS", 210 - margenX, y, { align: "right" });
  pdf.setFontSize(9);
  pdf.setFont("helvetica", "normal");
  y += 5;
  if (empresa.direccion) { pdf.text(empresa.direccion, 210 - margenX, y, { align: "right" }); y += 4; }
  if (empresa.telefono) { pdf.text(`Tel: ${empresa.telefono}`, 210 - margenX, y, { align: "right" }); y += 4; }
  if (empresa.rfc) { pdf.text(`RFC: ${empresa.rfc}`, 210 - margenX, y, { align: "right" }); y += 4; }

  y = Math.max(y, 34);
  pdf.setDrawColor(255, 107, 0);
  pdf.setLineWidth(0.8);
  pdf.line(margenX, y, 210 - margenX, y);
  y += 8;

  // --- Título del documento ---
  const titulo = tipo === "cotizacion" ? "COTIZACIÓN" : "ORDEN DE TRABAJO";
  pdf.setFontSize(14);
  pdf.setFont("helvetica", "bold");
  pdf.text(titulo, margenX, y);
  pdf.text(documento.folio || "", 210 - margenX, y, { align: "right" });
  y += 7;

  pdf.setFontSize(9);
  pdf.setFont("helvetica", "normal");
  const fecha = documento.fecha_iso ? new Date(documento.fecha_iso) : new Date();
  pdf.text(`Fecha: ${formatoFecha(fecha)}`, margenX, y);
  if (tipo === "cotizacion" && documento.vigenciaHasta) {
    pdf.text(`Vigente hasta: ${formatoFecha(new Date(documento.vigenciaHasta))}`, 210 - margenX, y, { align: "right" });
  }
  y += 8;

  // --- Cliente ---
  pdf.setFont("helvetica", "bold");
  pdf.text("Cliente:", margenX, y);
  pdf.setFont("helvetica", "normal");
  pdf.text(documento.clienteNombre || "", margenX + 20, y);
  y += 5;
  if (documento.telefono) {
    pdf.text(`Teléfono: ${documento.telefono}`, margenX, y);
    y += 5;
  }
  if (tipo === "orden" && documento.vehiculo) {
    pdf.text(`Vehículo: ${documento.vehiculo} ${documento.placas ? "· Placas: " + documento.placas : ""}`, margenX, y);
    y += 5;
  }
  y += 3;

  // --- Tabla de conceptos ---
  pdf.setFillColor(11, 13, 12);
  pdf.rect(margenX, y, 210 - margenX * 2, 7, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.text("Descripción", margenX + 2, y + 5);
  pdf.text("Cant.", 140, y + 5);
  pdf.text("Precio", 160, y + 5);
  pdf.text("Importe", 210 - margenX - 2, y + 5, { align: "right" });
  y += 10;
  pdf.setTextColor(0, 0, 0);
  pdf.setFont("helvetica", "normal");

  (documento.conceptos || []).forEach((c) => {
    if (y > 250) { pdf.addPage(); y = 20; }
    const importe = (Number(c.cantidad) || 0) * (Number(c.precio) || 0);
    pdf.text(String(c.descripcion || ""), margenX + 2, y, { maxWidth: 110 });
    pdf.text(String(c.cantidad), 140, y);
    pdf.text(formatoMoneda(c.precio), 160, y);
    pdf.text(formatoMoneda(importe), 210 - margenX - 2, y, { align: "right" });
    y += 6;
  });

  y += 4;
  pdf.setDrawColor(200, 200, 200);
  pdf.line(120, y, 210 - margenX, y);
  y += 6;

  const filaTotal = (label, valor, negrita = false) => {
    pdf.setFont("helvetica", negrita ? "bold" : "normal");
    pdf.text(label, 150, y);
    pdf.text(valor, 210 - margenX - 2, y, { align: "right" });
    y += 6;
  };
  filaTotal("Subtotal:", formatoMoneda(documento.subtotal));
  if (documento.descuento) filaTotal("Descuento:", "-" + formatoMoneda(documento.descuento));
  filaTotal("IVA:", formatoMoneda(documento.iva));
  filaTotal("TOTAL:", formatoMoneda(documento.total), true);
  if (tipo === "orden") {
    filaTotal("Anticipo:", formatoMoneda(documento.anticipo));
    filaTotal("Saldo:", formatoMoneda(documento.saldo), true);
  }

  y += 6;
  if (documento.observaciones) {
    pdf.setFont("helvetica", "bold");
    pdf.text("Observaciones:", margenX, y);
    y += 5;
    pdf.setFont("helvetica", "normal");
    pdf.text(String(documento.observaciones), margenX, y, { maxWidth: 180 });
    y += 10;
  }
  if (documento.condiciones) {
    pdf.setFont("helvetica", "bold");
    pdf.text("Condiciones:", margenX, y);
    y += 5;
    pdf.setFont("helvetica", "normal");
    pdf.text(String(documento.condiciones), margenX, y, { maxWidth: 180 });
  }

  // --- Footer ---
  const paginaAltura = pdf.internal.pageSize.getHeight();
  pdf.setFontSize(7.5);
  pdf.setTextColor(120, 120, 120);
  pdf.text(
    `${empresa.nombreComercial || "ALARMAS Y GPS"} | ${empresa.eslogan || ""}`,
    105,
    paginaAltura - 14,
    { align: "center" }
  );
  pdf.text(`Desarrollado por ${nexora.nombre}`, 105, paginaAltura - 10, { align: "center" });
  pdf.text(nexora.responsableTecnico, 105, paginaAltura - 6, { align: "center" });

  const filename = `${documento.folio || tipo}.pdf`;
  const blob = pdf.output("blob");
  return { ok: true, blob, filename, pdfInstance: pdf };
}

export function descargarPDF(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function compartirPDF(blob, filename) {
  if (navigator.canShare && navigator.share) {
    try {
      const archivo = new File([blob], filename, { type: "application/pdf" });
      if (navigator.canShare({ files: [archivo] })) {
        await navigator.share({ files: [archivo], title: filename });
        return { ok: true, metodo: "web-share" };
      }
    } catch (err) {
      console.warn("Web Share falló, cae a descarga:", err);
    }
  }
  descargarPDF(blob, filename);
  return { ok: true, metodo: "descarga" };
}
