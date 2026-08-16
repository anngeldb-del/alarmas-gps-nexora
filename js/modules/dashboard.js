/**
 * modules/dashboard.js
 * ⚠️ OPTIMIZACIÓN DE COSTO (Fases 7-8): el Dashboard es la pantalla que
 * más se abre en todo el sistema. Estado actual de cada KPI:
 *
 * 1. Ingresos hoy/mes: una sola consulta a `pagos` acotada por fecha
 *    (ver ingresos.js) — el costo NUNCA crece con el historial total,
 *    solo con la actividad del mes actual (siempre pequeña).
 * 2. Órdenes abiertas / cotizaciones pendientes: `getCountFromServer`
 *    — cuenta en el servidor sin descargar documentos, ~1 lectura
 *    sin importar si hay 10 o 10,000.
 * 3. Ticket promedio: PATRÓN DE CONTADOR ACUMULADO. En vez de leer
 *    N órdenes entregadas cada vez, se lee un solo documento
 *    (`estadisticas/global`) que `ordenes.js` mantiene actualizado con
 *    `increment()` cada vez que una orden se marca "entregada". 1 lectura
 *    para siempre, sin importar si el negocio lleva 1 mes o 10 años.
 * 4. Stock bajo: primero se CUENTA cuántos productos activos hay
 *    (`getCountFromServer`, 1 lectura). Solo si hay al menos 1 se
 *    descargan los documentos completos para comparar stock vs mínimo
 *    (comparación entre dos campos que Firestore no puede resolver en
 *    la consulta). Como Inventario está oculto para este negocio, en la
 *    práctica esto cuesta 1 lectura y nunca más.
 * 5. Todo el paquete de KPIs se cachea 30 segundos (`cache.js`) — si
 *    navegas a otra vista y regresas al Dashboard rápido, no se vuelve
 *    a leer nada de Firestore.
 */
import { listarAdeudos } from "./adeudos.js";
import { listarIngresos, totalIngresos, filtrarPorHoy } from "./ingresos.js";
import { db, FIREBASE_CONFIGURED } from "../firebase.js";
import {
  collection,
  doc,
  getDoc,
  query,
  where,
  getDocs,
  getCountFromServer,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { formatoMoneda } from "../utils.js";
import { conCache } from "../cache.js";

async function contarOrdenesAbiertas() {
  if (!FIREBASE_CONFIGURED) return 0;
  try {
    const q = query(collection(db, "ordenes"), where("estado", "not-in", ["entregada", "cancelada"]));
    const snap = await getCountFromServer(q);
    return snap.data().count;
  } catch (err) {
    console.warn("No se pudo contar órdenes abiertas (puede requerir crear un índice, revisa la consola):", err);
    return 0;
  }
}

async function contarCotizacionesPendientes() {
  if (!FIREBASE_CONFIGURED) return 0;
  try {
    const q = query(collection(db, "cotizaciones"), where("estado", "in", ["borrador", "enviada", "vista"]));
    const snap = await getCountFromServer(q);
    return snap.data().count;
  } catch (err) {
    console.warn("No se pudo contar cotizaciones pendientes:", err);
    return 0;
  }
}

/** Lee el contador acumulado — 1 sola lectura, sin importar el historial. */
async function obtenerTicketPromedio() {
  if (!FIREBASE_CONFIGURED) return 0;
  try {
    const snap = await getDoc(doc(db, "estadisticas", "global"));
    if (!snap.exists()) return 0;
    const data = snap.data();
    const cantidad = Number(data.cantidadEntregadas) || 0;
    const suma = Number(data.sumaTotalEntregadas) || 0;
    return cantidad > 0 ? suma / cantidad : 0;
  } catch (err) {
    console.warn("No se pudo leer el contador de estadísticas:", err);
    return 0;
  }
}

/** Cuenta primero (barato); solo descarga documentos si de verdad hay productos que revisar. */
async function calcularStockBajo() {
  if (!FIREBASE_CONFIGURED) return 0;
  try {
    const qActivos = query(collection(db, "productos"), where("activo", "==", true));
    const conteo = await getCountFromServer(qActivos);
    if (conteo.data().count === 0) return 0; // Inventario sin uso: 1 lectura y listo

    const snap = await getDocs(qActivos);
    return snap.docs.filter((d) => Number(d.data().stock) <= Number(d.data().stockMinimo)).length;
  } catch (err) {
    console.warn("No se pudo calcular stock bajo:", err);
    return 0;
  }
}

async function cargarKPIsSinCache() {
  const [adeudos, pagosDelMes, ordenesAbiertas, cotizacionesPendientes, productosStockBajo, ticketPromedio] = await Promise.all([
    listarAdeudos("todos"),
    listarIngresos("mes"), // una sola consulta; "hoy" se deriva de esta misma lista
    contarOrdenesAbiertas(),
    contarCotizacionesPendientes(),
    calcularStockBajo(),
    obtenerTicketPromedio(),
  ]);

  const clientesConAdeudo = new Set(adeudos.map((a) => a.clienteId)).size;
  const totalPorCobrar = adeudos.reduce((acc, a) => acc + a.saldo, 0);
  const pagosDeHoy = filtrarPorHoy(pagosDelMes);

  return {
    clientesConAdeudo,
    totalPorCobrar,
    ingresosHoy: totalIngresos(pagosDeHoy),
    ingresosMes: totalIngresos(pagosDelMes),
    cotizacionesPendientes,
    ordenesAbiertas,
    productosStockBajo,
    ticketPromedio,
  };
}

export async function cargarKPIs() {
  return conCache("dashboard:kpis", cargarKPIsSinCache, 30000);
}

export function renderKPIs(kpis) {
  const contenedor = document.getElementById("kpi-grid");
  if (!contenedor) return;

  const tarjetas = [
    { label: "Ingresos hoy", valor: formatoMoneda(kpis.ingresosHoy) },
    { label: "Ingresos del mes", valor: formatoMoneda(kpis.ingresosMes) },
    { label: "Órdenes abiertas", valor: kpis.ordenesAbiertas },
    { label: "Cotizaciones pendientes", valor: kpis.cotizacionesPendientes },
    { label: "Clientes con adeudo", valor: kpis.clientesConAdeudo },
    { label: "Total por cobrar", valor: formatoMoneda(kpis.totalPorCobrar) },
    { label: "Ticket promedio", valor: formatoMoneda(kpis.ticketPromedio) },
    { label: "Stock bajo", valor: kpis.productosStockBajo },
  ];

  contenedor.innerHTML = tarjetas
    .map(
      (t) => `
      <div class="kpi-card">
        <span class="kpi-card__valor">${t.valor}</span>
        <span class="kpi-card__label">${t.label}</span>
      </div>`
    )
    .join("");
}
