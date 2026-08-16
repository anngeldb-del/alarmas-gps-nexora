/**
 * audit.js — Escribe en la colección `auditoria`.
 * Toda función de negocio crítica (crear, editar, cancelar, pago, ajuste
 * de inventario, conversión, cambios de configuración) debe llamar a
 * registrarAuditoria() — ver sección 44 del brief.
 */
import {
  collection,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { auth, db, FIREBASE_CONFIGURED } from "./firebase.js";

/**
 * @param {Object} entrada
 * @param {string} entrada.accion   ej. "crear_cotizacion"
 * @param {string} entrada.modulo   ej. "cotizaciones"
 * @param {string} [entrada.folio]
 * @param {string} [entrada.idDocumento]
 * @param {Object} [entrada.datos]  detalles relevantes (no sensibles)
 */
export async function registrarAuditoria(entrada) {
  if (!FIREBASE_CONFIGURED) {
    console.warn("[auditoria omitida: Firebase no configurado]", entrada);
    return { ok: false, error: "Firebase no configurado" };
  }
  try {
    const usuario = auth.currentUser;
    await addDoc(collection(db, "auditoria"), {
      usuarioUid: usuario?.uid || null,
      usuarioEmail: usuario?.email || "sistema",
      accion: entrada.accion,
      modulo: entrada.modulo,
      folio: entrada.folio || null,
      idDocumento: entrada.idDocumento || null,
      datos: entrada.datos || null,
      fecha: serverTimestamp(),
    });
    return { ok: true };
  } catch (err) {
    // Un fallo de auditoría NUNCA debe tumbar la operación principal,
    // pero sí debe quedar visible en consola para diagnóstico.
    console.error("No se pudo registrar auditoría:", err);
    return { ok: false, error: err.message };
  }
}
