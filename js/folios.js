/**
 * folios.js
 * Generación de folios ÚNICOS y sin duplicados, incluso con dos usuarios
 * creando documentos al mismo tiempo (sección 30). Usa runTransaction:
 * el contador vive en `folios/{tipo}_{periodo}` y se incrementa de forma
 * atómica — si dos clientes corren esto simultáneamente, Firestore
 * reintenta la transacción perdedora automáticamente.
 *
 * Formato: COT-2026-08-001 / ORD-2026-08-001
 */
import {
  doc,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db, FIREBASE_CONFIGURED } from "./firebase.js";

const PREFIJOS = {
  cotizacion: "COT",
  orden: "ORD",
};

/**
 * @param {'cotizacion'|'orden'} tipo
 * @returns {Promise<{ok:boolean, folio?:string, error?:string}>}
 */
export async function generarFolio(tipo) {
  if (!FIREBASE_CONFIGURED) {
    return { ok: false, error: "Firebase no configurado" };
  }
  const prefijo = PREFIJOS[tipo];
  if (!prefijo) return { ok: false, error: `Tipo de folio desconocido: ${tipo}` };

  const ahora = new Date();
  const anio = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, "0");
  const idContador = `${tipo}_${anio}_${mes}`; // periodo mensual
  const contadorRef = doc(db, "folios", idContador);

  try {
    const folio = await runTransaction(db, async (tx) => {
      const snap = await tx.get(contadorRef);
      const siguiente = snap.exists() ? snap.data().ultimo + 1 : 1;
      tx.set(contadorRef, { ultimo: siguiente, tipo, anio, mes }, { merge: true });
      const numero = String(siguiente).padStart(3, "0");
      return `${prefijo}-${anio}-${mes}-${numero}`;
    });
    return { ok: true, folio };
  } catch (err) {
    console.error("Error generando folio:", err);
    return { ok: false, error: "No fue posible generar el folio. Intenta de nuevo." };
  }
}
