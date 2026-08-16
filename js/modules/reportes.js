/**
 * modules/reportes.js — Reporte mensual real (sección 38-39).
 *
 * ⚠️ OPTIMIZACIÓN DE COSTO (Fase 7): la versión anterior traía las
 * colecciones COMPLETAS de ordenes/cotizaciones/pagos/clientes/movimientos
 * (sin filtro) cada vez que se abría un reporte, sin importar qué mes se
 * pidiera — el costo crecía para siempre con cada mes que pasara. Ahora
 * cada consulta va acotada por fecha directo en Firestore (`where` sobre
 * el campo `fecha`), así que un reporte de agosto 2026 solo lee los
 * documentos de agosto 2026, sin importar cuántos años de historial
 * tenga la base de datos completa.
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
import { gastosDelRango, totalGastos } from "./gastos.js";
import { listarAdeudos } from "./adeudos.js";
import { listarProductos } from "./productos.js";
import { listarClientes } from "./clientes.js";

function rangoDelMes(anio, mes) {
  // mes: 1-12
  const desde = new Date(anio, mes - 1, 1);
  const hasta = new Date(anio, mes, 0, 23, 59, 59);
  return { desde, hasta };
}

/** Consulta genérica acotada por fecha — solo lee lo que cae en el rango. */
async function traerPorRangoDeFecha(nombreColeccion, campoFecha, desde, hasta) {
  const q = query(
    collection(db, nombreColeccion),
    where(campoFecha, ">=", Timestamp.fromDate(desde)),
    where(campoFecha, "<=", Timestamp.fromDate(hasta)),
    orderBy(campoFecha, "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function generarReporteMensual(anio, mes) {
  if (!FIREBASE_CONFIGURED) {
    return { ok: false, error: "Firebase no configurado. No se puede generar el reporte." };
  }

  const { desde, hasta } = rangoDelMes(anio, mes);

  const [ordenesDelMes, cotizacionesDelMes, pagosDelMes, clientesNuevosDelMes, movimientosDelMes, gastosDelMes, adeudosActuales, productos] =
    await Promise.all([
      traerPorRangoDeFecha("ordenes", "fecha", desde, hasta),
      traerPorRangoDeFecha("cotizaciones", "fecha", desde, hasta),
      traerPorRangoDeFecha("pagos", "fecha", desde, hasta),
      traerPorRangoDeFecha("clientes", "fechaRegistro", desde, hasta),
      traerPorRangoDeFecha("movimientosInventario", "fecha", desde, hasta),
      gastosDelRango(desde, hasta),
      listarAdeudos("todos"), // adeudo ACTUAL (a hoy), no tiene sentido acotarlo al mes histórico
      listarProductos({ soloActivos: true, limite: 300 }),
      // Nota: la lista COMPLETA de clientes (para la hoja "CLIENTES" del
      // Excel) YA NO se trae aquí — solo se pide bajo demanda cuando el
      // usuario efectivamente da clic en "Exportar Excel" (ver
      // obtenerClientesParaExportar más abajo). Así, solo VER el reporte
      // en pantalla no cuesta esas lecturas si nunca exportas.
    ]);

  const ingresos = pagosDelMes.reduce((acc, p) => acc + (Number(p.importe) || 0), 0);
  const ventas = ordenesDelMes.reduce((acc, o) => acc + (Number(o.total) || 0), 0);
  const cotizacionesAceptadas = cotizacionesDelMes.filter((c) => ["aceptada", "convertida"].includes(c.estado));
  const adeudos = adeudosActuales.reduce((acc, a) => acc + a.saldo, 0);

  // Utilidad estimada: ingresos del mes - costo de productos con salida en el mes - gastos del mes
  const costoProductosSalidos = movimientosDelMes
    .filter((m) => m.tipo === "salida")
    .reduce((acc, m) => {
      const producto = productos.find((p) => p.id === m.productoId);
      return acc + (producto ? Number(producto.costo) * Number(m.cantidad) : 0);
    }, 0);
  const gastos = totalGastos(gastosDelMes);
  const utilidadEstimada = ingresos - costoProductosSalidos - gastos;

  // Productos más utilizados (por movimientos de salida)
  const usoPorProducto = {};
  movimientosDelMes
    .filter((m) => m.tipo === "salida")
    .forEach((m) => {
      usoPorProducto[m.productoId] = (usoPorProducto[m.productoId] || 0) + Number(m.cantidad);
    });
  const productosMasUsados = Object.entries(usoPorProducto)
    .map(([productoId, cantidad]) => {
      const producto = productos.find((p) => p.id === productoId);
      return { nombre: producto?.nombre || "Producto eliminado", cantidad };
    })
    .sort((a, b) => b.cantidad - a.cantidad)
    .slice(0, 10);

  return {
    ok: true,
    anio,
    mes,
    ingresos,
    ventas,
    ordenesCreadas: ordenesDelMes.length,
    ordenesEntregadas: ordenesDelMes.filter((o) => o.estado === "entregada").length,
    cotizacionesCreadas: cotizacionesDelMes.length,
    cotizacionesAceptadas: cotizacionesAceptadas.length,
    clientesNuevos: clientesNuevosDelMes.length,
    productosMasUsados,
    pagosPendientesCantidad: adeudosActuales.length,
    adeudos,
    gastos,
    utilidadEstimada,
    // Datos crudos para exportación a Excel:
    _raw: { ordenesDelMes, cotizacionesDelMes, pagosDelMes, productos, movimientosDelMes, gastosDelMes },
  };
}

/**
 * Lista completa de clientes activos, SOLO para la hoja "CLIENTES" del
 * Excel — se llama únicamente cuando el usuario da clic en "Exportar
 * Excel", nunca al abrir la pantalla de Reportes.
 */
export async function obtenerClientesParaExportar() {
  return listarClientes({ soloActivos: true, limite: 500 });
}
