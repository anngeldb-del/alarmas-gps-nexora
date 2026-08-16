/**
 * modules/backup.js — Copia de seguridad (sección 46).
 * Lee todas las colecciones relevantes y las entrega como JSON descargable
 * o como libro de Excel con una hoja por colección.
 */
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db, FIREBASE_CONFIGURED } from "../firebase.js";
import { exportarLibroExcel } from "../excel.js";
import { registrarAuditoria } from "../audit.js";

const COLECCIONES_BACKUP = [
  "clientes",
  "productos",
  "ordenes",
  "cotizaciones",
  "pagos",
  "movimientosInventario",
  "configuracion",
];

function serializarFechas(obj) {
  const copia = { ...obj };
  Object.keys(copia).forEach((k) => {
    if (copia[k]?.toDate) copia[k] = copia[k].toDate().toISOString();
  });
  return copia;
}

async function leerTodasLasColecciones() {
  const resultado = {};
  for (const nombre of COLECCIONES_BACKUP) {
    const snap = await getDocs(collection(db, nombre));
    resultado[nombre] = snap.docs.map((d) => serializarFechas({ id: d.id, ...d.data() }));
  }
  return resultado;
}

export async function generarBackupJSON() {
  if (!FIREBASE_CONFIGURED) return { ok: false, error: "Firebase no configurado." };
  try {
    const datos = await leerTodasLasColecciones();
    const contenido = JSON.stringify({ generadoEn: new Date().toISOString(), datos }, null, 2);
    const blob = new Blob([contenido], { type: "application/json" });
    const filename = `backup-alarmas-gps-${new Date().toISOString().slice(0, 10)}.json`;

    await registrarAuditoria({ accion: "generar_backup_json", modulo: "backup" });
    return { ok: true, blob, filename };
  } catch (err) {
    console.error("Error generando backup JSON:", err);
    return { ok: false, error: "No fue posible generar la copia de seguridad." };
  }
}

export async function generarBackupExcel() {
  if (!FIREBASE_CONFIGURED) return { ok: false, error: "Firebase no configurado." };
  try {
    const datos = await leerTodasLasColecciones();
    const hojas = COLECCIONES_BACKUP.map((nombre) => ({
      nombre: nombre.toUpperCase(),
      filas: datos[nombre],
    }));
    const filename = `backup-alarmas-gps-${new Date().toISOString().slice(0, 10)}.xlsx`;
    const r = exportarLibroExcel(hojas, filename);
    if (r.ok) {
      await registrarAuditoria({ accion: "generar_backup_excel", modulo: "backup" });
    }
    return r;
  } catch (err) {
    console.error("Error generando backup Excel:", err);
    return { ok: false, error: "No fue posible generar la copia de seguridad." };
  }
}

export function descargarBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
