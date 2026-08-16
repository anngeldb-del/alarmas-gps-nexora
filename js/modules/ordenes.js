/**
 * modules/ordenes.js — Órdenes de trabajo (secciones 23-24, 26, 61-62).
 * - Folio único vía folios.js (transaccional).
 * - Totales SIEMPRE calculados con utils.js (nunca fórmulas duplicadas).
 * - Al pasar a "entregada" se descuenta inventario UNA sola vez
 *   (yaSeDescontoInventario evita el doble descuento aunque el usuario
 *   presione el botón varias veces o haya reintentos de red).
 */
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit as fsLimit,
  startAfter,
  serverTimestamp,
  increment,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db, FIREBASE_CONFIGURED } from "../firebase.js";
import { registrarAuditoria } from "../audit.js";
import { generarFolio } from "../folios.js";
import { registrarMovimiento, yaSeDescontoInventario } from "./productos.js";
import { registrarPago, totalPagadoDeOrden } from "./pagos.js";
import {
  calcularSubtotal,
  calcularConDescuento,
  calcularIVA,
  calcularTotal,
  calcularSaldo,
} from "../utils.js";
import { obtenerConfiguracionEmpresa } from "./configuracion.js";
import { invalidarPrefijo } from "../cache.js";

export const ESTADOS_ORDEN = [
  "pendiente",
  "en_proceso",
  "esperando_piezas",
  "terminada",
  "entregada",
  "cancelada",
];

const TRANSICIONES_VALIDAS = {
  pendiente: ["en_proceso", "cancelada"],
  en_proceso: ["esperando_piezas", "terminada", "cancelada"],
  esperando_piezas: ["en_proceso", "terminada", "cancelada"],
  terminada: ["entregada", "en_proceso"],
  entregada: [],
  cancelada: [],
};

function validarOrden(datos) {
  const errores = [];
  if (!datos.clienteId) errores.push("Debes seleccionar un cliente.");
  if (!Array.isArray(datos.conceptos) || datos.conceptos.length === 0) {
    errores.push("La orden debe tener al menos un concepto/producto.");
  }
  (datos.conceptos || []).forEach((c) => {
    if (Number(c.cantidad) <= 0) errores.push(`Cantidad inválida en "${c.descripcion || "concepto"}".`);
    if (Number(c.precio) < 0) errores.push(`Precio inválido en "${c.descripcion || "concepto"}".`);
  });
  if (Number(datos.descuento) < 0) errores.push("El descuento no puede ser negativo.");
  if (Number(datos.anticipo) < 0) errores.push("El anticipo no puede ser negativo.");
  return errores;
}

async function calcularTotalesOrden(datos) {
  const empresa = await obtenerConfiguracionEmpresa();
  const subtotal = calcularSubtotal(datos.conceptos);
  const subtotalNeto = calcularConDescuento(subtotal, datos.descuento);
  const iva = calcularIVA(subtotalNeto, empresa.ivaPorcentaje, empresa.ivaActivo);
  const total = calcularTotal(subtotalNeto, iva);
  // ⚠️ CORRECCIÓN DE INTEGRIDAD FINANCIERA (Fase 8):
  // Antes esta función tomaba `datos.anticipo` tal cual venía del formulario
  // y con eso fijaba `saldo`. Esto permitía que EDITAR una orden sobrescribiera
  // el saldo sin pasar por `pagos.js` — es decir, sin crear un pago real ni
  // auditoría, rompiendo la relación entre "saldo mostrado" y "pagos guardados".
  // Ahora toda orden nace con saldo = total (sin pagos todavía). El anticipo
  // capturado al crear se registra como un PAGO real (ver crearOrden), y al
  // editar, el saldo se recalcula contra los pagos reales de Firestore
  // (ver editarOrden) — nunca contra un número suelto del formulario.
  return { subtotal, subtotalNeto, iva, total, anticipo: 0, saldo: total };
}

export async function crearOrden(datos) {
  if (!FIREBASE_CONFIGURED) return { ok: false, error: "Firebase no configurado." };
  const errores = validarOrden(datos);
  if (errores.length) return { ok: false, error: errores.join(" ") };

  const folioResp = await generarFolio("orden");
  if (!folioResp.ok) return { ok: false, error: folioResp.error };

  const totales = await calcularTotalesOrden(datos);

  try {
    const ref = await addDoc(collection(db, "ordenes"), {
      folio: folioResp.folio,
      clienteId: datos.clienteId,
      clienteNombre: datos.clienteNombre || "",
      telefono: datos.telefono || "",
      vehiculo: datos.vehiculo || "",
      marca: datos.marca || "",
      modelo: datos.modelo || "",
      anio: datos.anio || "",
      placas: datos.placas || "",
      unidad: datos.unidad || "",
      numeroSerie: datos.numeroSerie || "",
      descripcion: datos.descripcion || "",
      conceptos: datos.conceptos,
      descuento: Number(datos.descuento) || 0,
      ...totales,
      tecnicoUid: datos.tecnicoUid || null,
      tecnicoNombre: datos.tecnicoNombre || "",
      estado: "pendiente",
      fechaEstimada: datos.fechaEstimada || null,
      fechaReal: null,
      observaciones: datos.observaciones || "",
      cotizacionOrigenId: datos.cotizacionOrigenId || null,
      fecha: serverTimestamp(),
    });

    await registrarAuditoria({
      accion: "crear_orden",
      modulo: "ordenes",
      idDocumento: ref.id,
      folio: folioResp.folio,
      datos: { total: totales.total },
    });

    // Si se capturó un anticipo al crear la orden, se registra como un
    // PAGO real (con su propio documento en `pagos`, auditado, y que
    // actualiza saldo/anticipo de la orden vía la transacción de
    // pagos.js) — nunca como un número suelto sin respaldo.
    const anticipoInicial = Number(datos.anticipo) || 0;
    if (anticipoInicial > 0) {
      const resultadoPago = await registrarPago({
        ordenId: ref.id,
        importe: anticipoInicial,
        metodo: datos.metodoAnticipo || "efectivo",
        observaciones: "Anticipo registrado al crear la orden",
      });
      if (!resultadoPago.ok) {
        // La orden ya se creó (con saldo=total); avisamos que el anticipo
        // no se pudo registrar para que el usuario lo capture manualmente
        // desde "Registrar pago" — no perdemos la orden por esto.
        return {
          ok: true,
          id: ref.id,
          folio: folioResp.folio,
          avisoAnticipo: `La orden se creó, pero el anticipo no se pudo registrar: ${resultadoPago.error}. Regístralo manualmente desde "Registrar pago".`,
        };
      }
    }

    invalidarPrefijo("dashboard");
    return { ok: true, id: ref.id, folio: folioResp.folio };
  } catch (err) {
    console.error("Error creando orden:", err);
    return { ok: false, error: "No fue posible guardar la orden. Verifica tu conexión e inténtalo de nuevo." };
  }
}

export async function editarOrden(id, datos) {
  if (!FIREBASE_CONFIGURED) return { ok: false, error: "Firebase no configurado." };
  const errores = validarOrden(datos);
  if (errores.length) return { ok: false, error: errores.join(" ") };

  const totales = await calcularTotalesOrden(datos); // totales.saldo = totales.total (punto de partida)

  try {
    // ⚠️ El saldo real se calcula contra los PAGOS REGISTRADOS en Firestore,
    // nunca contra un campo de formulario — así editar una orden (cambiar
    // conceptos, precios, descuento) jamás puede desincronizar el saldo de
    // los pagos reales que ya existen para esa orden.
    const totalYaPagado = await totalPagadoDeOrden(id);
    const saldoReal = Math.max(totales.total - totalYaPagado, 0);

    await updateDoc(doc(db, "ordenes", id), {
      clienteId: datos.clienteId,
      clienteNombre: datos.clienteNombre || "",
      telefono: datos.telefono || "",
      vehiculo: datos.vehiculo || "",
      marca: datos.marca || "",
      modelo: datos.modelo || "",
      anio: datos.anio || "",
      placas: datos.placas || "",
      unidad: datos.unidad || "",
      numeroSerie: datos.numeroSerie || "",
      descripcion: datos.descripcion || "",
      conceptos: datos.conceptos,
      descuento: Number(datos.descuento) || 0,
      subtotal: totales.subtotal,
      subtotalNeto: totales.subtotalNeto,
      iva: totales.iva,
      total: totales.total,
      anticipo: totalYaPagado,
      saldo: saldoReal,
      observaciones: datos.observaciones || "",
      actualizadoEn: serverTimestamp(),
    });
    await registrarAuditoria({ accion: "editar_orden", modulo: "ordenes", idDocumento: id });
    return { ok: true };
  } catch (err) {
    console.error("Error editando orden:", err);
    return { ok: false, error: "No fue posible guardar los cambios." };
  }
}

/**
 * Cambia el estado de una orden validando la máquina de estados y
 * ejecutando efectos asociados (descuento de inventario al entregar),
 * sin duplicar efectos si se llama más de una vez (sección 61).
 */
export async function cambiarEstadoOrden(id, nuevoEstado) {
  if (!FIREBASE_CONFIGURED) return { ok: false, error: "Firebase no configurado." };
  if (!ESTADOS_ORDEN.includes(nuevoEstado)) return { ok: false, error: "Estado inválido." };

  try {
    const ref = doc(db, "ordenes", id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { ok: false, error: "La orden no existe." };
    const orden = snap.data();

    const permitidas = TRANSICIONES_VALIDAS[orden.estado] || [];
    if (!permitidas.includes(nuevoEstado)) {
      return {
        ok: false,
        error: `No se puede cambiar de "${orden.estado}" a "${nuevoEstado}" directamente.`,
      };
    }

    // Efecto: al ENTREGAR, descontar inventario de los conceptos que
    // referencian un producto — pero solo si no se ha hecho ya para este folio.
    if (nuevoEstado === "entregada") {
      const yaDescontado = await yaSeDescontoInventario(orden.folio);
      if (!yaDescontado) {
        const conceptosConProducto = (orden.conceptos || []).filter((c) => c.productoId);
        for (const c of conceptosConProducto) {
          const r = await registrarMovimiento({
            productoId: c.productoId,
            tipo: "salida",
            cantidad: c.cantidad,
            motivo: "salida_por_orden",
            folioOrden: orden.folio,
          });
          if (!r.ok) {
            return {
              ok: false,
              error: `No se pudo actualizar el inventario de "${c.descripcion}": ${r.error}. La orden NO cambió de estado.`,
            };
          }
        }
      }
    }

    await updateDoc(ref, {
      estado: nuevoEstado,
      fechaReal: nuevoEstado === "entregada" ? serverTimestamp() : orden.fechaReal || null,
    });

    // ⚠️ PATRÓN DE CONTADOR ACUMULADO (Fase 8 — optimización de costo a largo plazo):
    // En vez de que el Dashboard tenga que LEER cientos/miles de órdenes
    // entregadas para calcular el ticket promedio, aquí se acumula la suma
    // y la cantidad en un solo documento (`estadisticas/global`). Leer ese
    // documento cuesta 1 lectura, sin importar si el negocio lleva 1 mes o
    // 10 años de historial — el costo NUNCA crece con el tiempo.
    if (nuevoEstado === "entregada") {
      try {
        await setDoc(
          doc(db, "estadisticas", "global"),
          {
            sumaTotalEntregadas: increment(Number(orden.total) || 0),
            cantidadEntregadas: increment(1),
            actualizadoEn: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (err) {
        // Nunca debe tumbar la entrega de la orden por un fallo aquí —
        // en el peor caso el ticket promedio queda desactualizado, no algo crítico.
        console.warn("No se pudo actualizar el contador de estadísticas:", err);
      }
    }

    await registrarAuditoria({
      accion: "cambiar_estado_orden",
      modulo: "ordenes",
      idDocumento: id,
      folio: orden.folio,
      datos: { de: orden.estado, a: nuevoEstado },
    });

    invalidarPrefijo("dashboard");
    return { ok: true };
  } catch (err) {
    console.error("Error cambiando estado de orden:", err);
    return { ok: false, error: "No fue posible cambiar el estado. Verifica tu conexión e inténtalo de nuevo." };
  }
}

/**
 * Versión paginada para la lista de órdenes (sección 64). Ordenadas por
 * fecha descendente, con cursor para pedir la siguiente página.
 */
export async function listarOrdenesPaginado({ cursor = null, tamanoPagina = 30 } = {}) {
  if (!FIREBASE_CONFIGURED) return { items: [], cursor: null, hayMas: false };
  try {
    const base = [collection(db, "ordenes"), orderBy("fecha", "desc")];
    const condiciones = cursor
      ? [...base, startAfter(cursor), fsLimit(tamanoPagina + 1)]
      : [...base, fsLimit(tamanoPagina + 1)];
    const snap = await getDocs(query(...condiciones));
    const docs = snap.docs;
    const hayMas = docs.length > tamanoPagina;
    const pagina = docs.slice(0, tamanoPagina);
    return {
      items: pagina.map((d) => ({ id: d.id, ...d.data() })),
      cursor: pagina.length ? pagina[pagina.length - 1] : null,
      hayMas,
    };
  } catch (err) {
    console.error("Error paginando órdenes:", err);
    return { items: [], cursor: null, hayMas: false };
  }
}

export async function listarOrdenes({ estado = null, clienteId = null, limite = 100 } = {}) {
  if (!FIREBASE_CONFIGURED) return [];
  try {
    const condiciones = [orderBy("fecha", "desc"), fsLimit(limite)];
    let q = query(collection(db, "ordenes"), ...condiciones);
    if (estado) {
      q = query(collection(db, "ordenes"), where("estado", "==", estado), ...condiciones);
    } else if (clienteId) {
      q = query(collection(db, "ordenes"), where("clienteId", "==", clienteId), ...condiciones);
    }
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("Error listando órdenes:", err);
    return [];
  }
}

export async function obtenerOrden(id) {
  if (!FIREBASE_CONFIGURED) return null;
  const snap = await getDoc(doc(db, "ordenes", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
