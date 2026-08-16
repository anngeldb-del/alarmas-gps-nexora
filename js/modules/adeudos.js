/**
 * modules/adeudos.js — Vista de adeudos (sección 21).
 * No es una colección propia: se calcula a partir de `ordenes` con
 * saldo > 0, agrupado por cliente. Esto evita que el saldo se desincronice
 * de la fuente real de verdad (los pagos).
 */
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db, FIREBASE_CONFIGURED } from "../firebase.js";

/**
 * @param {'todos'|'vencidos'|'parciales'|'sin_pago'} filtro
 */
export async function listarAdeudos(filtro = "todos") {
  if (!FIREBASE_CONFIGURED) return [];
  try {
    const q = query(collection(db, "ordenes"), where("saldo", ">", 0), orderBy("saldo", "desc"));
    const snap = await getDocs(q);
    const hoy = new Date();

    let filas = snap.docs.map((d) => {
      const o = d.data();
      const fechaOrden = o.fecha?.toDate ? o.fecha.toDate() : new Date();
      const diasAtraso = Math.max(0, Math.floor((hoy - fechaOrden) / (1000 * 60 * 60 * 24)));
      const esParcial = Number(o.anticipo) > 0;
      return {
        id: d.id,
        folio: o.folio,
        clienteId: o.clienteId,
        clienteNombre: o.clienteNombre,
        telefono: o.telefono,
        fecha: fechaOrden,
        total: Number(o.total) || 0,
        pagado: Number(o.anticipo) || 0,
        saldo: Number(o.saldo) || 0,
        diasAtraso,
        estadoPago: esParcial ? "parcial" : "sin_pago",
      };
    });

    if (filtro === "vencidos") filas = filas.filter((f) => f.diasAtraso > 30);
    if (filtro === "parciales") filas = filas.filter((f) => f.estadoPago === "parcial");
    if (filtro === "sin_pago") filas = filas.filter((f) => f.estadoPago === "sin_pago");

    return filas;
  } catch (err) {
    console.error("Error listando adeudos:", err);
    return [];
  }
}

export async function totalPorCobrarGlobal() {
  const filas = await listarAdeudos("todos");
  return filas.reduce((acc, f) => acc + f.saldo, 0);
}
