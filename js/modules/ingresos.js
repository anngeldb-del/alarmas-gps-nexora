/**
 * modules/ingresos.js — Ingresos reales (sección 36), derivados de `pagos`.
 * Nunca se guardan "ingresos" por separado — un ingreso ES un pago
 * registrado; así no hay dos fuentes de verdad que se puedan desincronizar.
 *
 * ⚠️ OPTIMIZACIÓN DE COSTO (Firebase cobra por documento leído):
 * Antes esta función traía TODA la colección `pagos` sin filtro y
 * filtraba por fecha en el navegador — el costo crecía para siempre con
 * cada pago que registraras, sin importar qué periodo pidieras. Ahora el
 * rango de fecha se manda a Firestore como filtro (`where`), así que solo
 * se leen (y se cobran) los documentos que realmente caen en el periodo.
 */
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db, FIREBASE_CONFIGURED } from "../firebase.js";

function inicioDe(periodo) {
  const hoy = new Date();
  if (periodo === "hoy") return new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  if (periodo === "semana") {
    const d = new Date(hoy);
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (periodo === "mes") return new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  if (periodo === "mes_anterior") return new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  if (periodo === "anio") return new Date(hoy.getFullYear(), 0, 1);
  return new Date(2000, 0, 1); // límite razonable en vez de new Date(0) (evita rangos absurdamente grandes)
}

function finDe(periodo) {
  const hoy = new Date();
  if (periodo === "mes_anterior") return new Date(hoy.getFullYear(), hoy.getMonth(), 0, 23, 59, 59);
  return new Date(hoy.getFullYear() + 1, 0, 1); // fin de próximo año, no "sin límite" literal
}

/**
 * @param {'hoy'|'ayer'|'semana'|'mes'|'mes_anterior'|'anio'|'personalizado'} periodo
 * @param {{desde?:Date, hasta?:Date}} [rangoPersonalizado]
 */
export async function listarIngresos(periodo = "mes", rangoPersonalizado = {}) {
  if (!FIREBASE_CONFIGURED) return [];
  try {
    let desde, hasta;
    if (periodo === "personalizado") {
      desde = rangoPersonalizado.desde || new Date(2000, 0, 1);
      hasta = rangoPersonalizado.hasta || new Date();
    } else {
      desde = inicioDe(periodo);
      hasta = finDe(periodo);
    }

    const q = query(
      collection(db, "pagos"),
      where("fecha", ">=", Timestamp.fromDate(desde)),
      where("fecha", "<=", Timestamp.fromDate(hasta)),
      orderBy("fecha", "desc")
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      return { id: d.id, ...data, fecha: data.fecha?.toDate ? data.fecha.toDate() : new Date() };
    });
  } catch (err) {
    console.error("Error listando ingresos:", err);
    return [];
  }
}

/**
 * Variante que reutiliza una lista ya traída (por ejemplo la del "mes")
 * para derivar "hoy" SIN volver a consultar Firestore — el día de hoy
 * siempre es un subconjunto del mes actual.
 */
export function filtrarPorHoy(pagosDelMes) {
  const inicioHoy = new Date();
  inicioHoy.setHours(0, 0, 0, 0);
  return pagosDelMes.filter((p) => p.fecha >= inicioHoy);
}

export function totalIngresos(pagos) {
  return pagos.reduce((acc, p) => acc + (Number(p.importe) || 0), 0);
}

export function agruparPorMetodo(pagos) {
  const grupos = {};
  pagos.forEach((p) => {
    grupos[p.metodo] = (grupos[p.metodo] || 0) + (Number(p.importe) || 0);
  });
  return grupos;
}
