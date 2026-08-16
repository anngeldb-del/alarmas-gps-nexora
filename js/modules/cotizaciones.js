/**
 * modules/cotizaciones.js — Cotizaciones (secciones 28-33, 42).
 * - Folio único vía folios.js.
 * - Totales SIEMPRE con utils.js.
 * - Conversión a orden: reutiliza ordenes.js (crearOrden), copia cliente,
 *   conceptos, descuento y observaciones, y NUNCA vuelve a pedir captura.
 * - Una cotización aceptada no se edita en silencio: cada edición queda
 *   auditada con fecha/usuario (sección 33).
 */
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit as fsLimit,
  startAfter,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db, FIREBASE_CONFIGURED } from "../firebase.js";
import { registrarAuditoria } from "../audit.js";
import { generarFolio } from "../folios.js";
import { calcularSubtotal, calcularConDescuento, calcularIVA, calcularTotal } from "../utils.js";
import { obtenerConfiguracionEmpresa } from "./configuracion.js";
import { invalidarPrefijo } from "../cache.js";
import { crearOrden } from "./ordenes.js";

export const ESTADOS_COTIZACION = [
  "borrador",
  "enviada",
  "vista",
  "aceptada",
  "rechazada",
  "vencida",
  "convertida",
];

const TRANSICIONES_VALIDAS = {
  borrador: ["enviada", "rechazada", "vencida"],
  enviada: ["vista", "aceptada", "rechazada", "vencida"],
  vista: ["aceptada", "rechazada", "vencida"],
  aceptada: ["convertida"],
  rechazada: [],
  vencida: [],
  convertida: [],
};

function validarCotizacion(datos) {
  const errores = [];
  if (!datos.clienteId) errores.push("Debes seleccionar un cliente.");
  if (!Array.isArray(datos.conceptos) || datos.conceptos.length === 0) {
    errores.push("La cotización debe tener al menos un concepto.");
  }
  (datos.conceptos || []).forEach((c) => {
    if (Number(c.cantidad) <= 0) errores.push(`Cantidad inválida en "${c.descripcion || "concepto"}".`);
    if (Number(c.precio) < 0) errores.push(`Precio inválido en "${c.descripcion || "concepto"}".`);
  });
  if (Number(datos.descuento) < 0) errores.push("El descuento no puede ser negativo.");
  return errores;
}

async function calcularTotalesCotizacion(datos) {
  const empresa = await obtenerConfiguracionEmpresa();
  const subtotal = calcularSubtotal(datos.conceptos);
  const subtotalNeto = calcularConDescuento(subtotal, datos.descuento);
  const iva = calcularIVA(subtotalNeto, empresa.ivaPorcentaje, empresa.ivaActivo);
  const total = calcularTotal(subtotalNeto, iva);
  return { subtotal, subtotalNeto, iva, total, ivaPorcentajeAplicado: empresa.ivaPorcentaje, ivaActivoAlCrear: empresa.ivaActivo };
}

export async function crearCotizacion(datos) {
  if (!FIREBASE_CONFIGURED) return { ok: false, error: "Firebase no configurado." };
  const errores = validarCotizacion(datos);
  if (errores.length) return { ok: false, error: errores.join(" ") };

  const folioResp = await generarFolio("cotizacion");
  if (!folioResp.ok) return { ok: false, error: folioResp.error };

  const empresa = await obtenerConfiguracionEmpresa();
  const totales = await calcularTotalesCotizacion(datos);
  const vigenciaDias = Number(empresa.vigenciaCotizacionDias) || 15;
  const hoy = new Date();
  const vence = new Date(hoy.getTime() + vigenciaDias * 24 * 60 * 60 * 1000);

  try {
    const ref = await addDoc(collection(db, "cotizaciones"), {
      folio: folioResp.folio,
      clienteId: datos.clienteId,
      clienteNombre: datos.clienteNombre || "",
      telefono: datos.telefono || "",
      conceptos: datos.conceptos,
      descuento: Number(datos.descuento) || 0,
      ...totales,
      condiciones: datos.condiciones || "",
      observaciones: datos.observaciones || "",
      estado: "borrador",
      fecha: serverTimestamp(),
      vigenciaHasta: vence.toISOString(),
      historialEdiciones: [],
      fecha_iso: hoy.toISOString(),
    });

    await registrarAuditoria({
      accion: "crear_cotizacion",
      modulo: "cotizaciones",
      idDocumento: ref.id,
      folio: folioResp.folio,
      datos: { total: totales.total },
    });

    invalidarPrefijo("dashboard");
    return { ok: true, id: ref.id, folio: folioResp.folio };
  } catch (err) {
    console.error("Error creando cotización:", err);
    return { ok: false, error: "No fue posible guardar la cotización. Verifica tu conexión e inténtalo de nuevo." };
  }
}

export async function editarCotizacion(id, datos) {
  if (!FIREBASE_CONFIGURED) return { ok: false, error: "Firebase no configurado." };
  const errores = validarCotizacion(datos);
  if (errores.length) return { ok: false, error: errores.join(" ") };

  try {
    const ref = doc(db, "cotizaciones", id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { ok: false, error: "La cotización no existe." };
    const actual = snap.data();

    if (["aceptada", "convertida"].includes(actual.estado)) {
      return {
        ok: false,
        error: `No se puede editar una cotización en estado "${actual.estado}". Si necesitas cambios, créala de nuevo.`,
      };
    }

    const totales = await calcularTotalesCotizacion(datos);

    await updateDoc(ref, {
      clienteId: datos.clienteId,
      clienteNombre: datos.clienteNombre || "",
      telefono: datos.telefono || "",
      conceptos: datos.conceptos,
      descuento: Number(datos.descuento) || 0,
      ...totales,
      condiciones: datos.condiciones || "",
      observaciones: datos.observaciones || "",
      actualizadoEn: serverTimestamp(),
    });

    await registrarAuditoria({
      accion: "editar_cotizacion",
      modulo: "cotizaciones",
      idDocumento: id,
      folio: actual.folio,
    });

    return { ok: true };
  } catch (err) {
    console.error("Error editando cotización:", err);
    return { ok: false, error: "No fue posible guardar los cambios." };
  }
}

export async function cambiarEstadoCotizacion(id, nuevoEstado) {
  if (!FIREBASE_CONFIGURED) return { ok: false, error: "Firebase no configurado." };
  if (!ESTADOS_COTIZACION.includes(nuevoEstado)) return { ok: false, error: "Estado inválido." };

  try {
    const ref = doc(db, "cotizaciones", id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { ok: false, error: "La cotización no existe." };
    const cot = snap.data();

    const permitidas = TRANSICIONES_VALIDAS[cot.estado] || [];
    if (!permitidas.includes(nuevoEstado)) {
      return { ok: false, error: `No se puede cambiar de "${cot.estado}" a "${nuevoEstado}" directamente.` };
    }

    await updateDoc(ref, { estado: nuevoEstado });
    await registrarAuditoria({
      accion: "cambiar_estado_cotizacion",
      modulo: "cotizaciones",
      idDocumento: id,
      folio: cot.folio,
      datos: { de: cot.estado, a: nuevoEstado },
    });
    invalidarPrefijo("dashboard");
    return { ok: true };
  } catch (err) {
    console.error("Error cambiando estado de cotización:", err);
    return { ok: false, error: "No fue posible cambiar el estado." };
  }
}

/**
 * Convierte una cotización ACEPTADA en una orden nueva, sin volver a
 * pedir captura (sección 32). Requiere que la cotización esté "aceptada".
 */
export async function convertirEnOrden(cotizacionId) {
  if (!FIREBASE_CONFIGURED) return { ok: false, error: "Firebase no configurado." };

  try {
    const ref = doc(db, "cotizaciones", cotizacionId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { ok: false, error: "La cotización no existe." };
    const cot = snap.data();

    if (cot.estado !== "aceptada") {
      return { ok: false, error: 'Solo se puede convertir una cotización en estado "aceptada".' };
    }

    const resultadoOrden = await crearOrden({
      clienteId: cot.clienteId,
      clienteNombre: cot.clienteNombre,
      telefono: cot.telefono,
      conceptos: cot.conceptos,
      descuento: cot.descuento,
      anticipo: 0,
      observaciones: cot.observaciones,
      cotizacionOrigenId: cotizacionId,
    });

    if (!resultadoOrden.ok) {
      return { ok: false, error: `No fue posible crear la orden: ${resultadoOrden.error}` };
    }

    await updateDoc(ref, {
      estado: "convertida",
      ordenGeneradaId: resultadoOrden.id,
      ordenGeneradaFolio: resultadoOrden.folio,
    });

    await registrarAuditoria({
      accion: "convertir_cotizacion_en_orden",
      modulo: "cotizaciones",
      idDocumento: cotizacionId,
      folio: cot.folio,
      datos: { ordenFolio: resultadoOrden.folio },
    });

    return { ok: true, ordenId: resultadoOrden.id, ordenFolio: resultadoOrden.folio };
  } catch (err) {
    console.error("Error convirtiendo cotización en orden:", err);
    return { ok: false, error: "No fue posible convertir la cotización. Verifica tu conexión e inténtalo de nuevo." };
  }
}

/**
 * Versión paginada para la lista de cotizaciones (sección 64).
 */
export async function listarCotizacionesPaginado({ cursor = null, tamanoPagina = 30 } = {}) {
  if (!FIREBASE_CONFIGURED) return { items: [], cursor: null, hayMas: false };
  try {
    const base = [collection(db, "cotizaciones"), orderBy("fecha", "desc")];
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
    console.error("Error paginando cotizaciones:", err);
    return { items: [], cursor: null, hayMas: false };
  }
}

export async function listarCotizaciones({ estado = null, clienteId = null, limite = 100 } = {}) {
  if (!FIREBASE_CONFIGURED) return [];
  try {
    const condiciones = [orderBy("fecha", "desc"), fsLimit(limite)];
    let q = query(collection(db, "cotizaciones"), ...condiciones);
    if (estado) {
      q = query(collection(db, "cotizaciones"), where("estado", "==", estado), ...condiciones);
    } else if (clienteId) {
      q = query(collection(db, "cotizaciones"), where("clienteId", "==", clienteId), ...condiciones);
    }
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("Error listando cotizaciones:", err);
    return [];
  }
}

export async function obtenerCotizacion(id) {
  if (!FIREBASE_CONFIGURED) return null;
  const snap = await getDoc(doc(db, "cotizaciones", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Revisa las cotizaciones "vivas" (borrador/enviada/vista) y marca como
 * "vencida" las que ya pasaron su `vigenciaHasta` (sección 29). Se llama
 * cada vez que se abre la vista de Cotizaciones — barato: solo trae las
 * que están en esos 3 estados (normalmente pocas), no la colección completa.
 */
export async function revisarYMarcarVencidas() {
  if (!FIREBASE_CONFIGURED) return { marcadas: 0 };
  try {
    const q = query(collection(db, "cotizaciones"), where("estado", "in", ["borrador", "enviada", "vista"]));
    const snap = await getDocs(q);
    const ahora = new Date();
    let marcadas = 0;

    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      const vence = data.vigenciaHasta ? new Date(data.vigenciaHasta) : null;
      if (vence && vence < ahora) {
        await updateDoc(doc(db, "cotizaciones", docSnap.id), { estado: "vencida" });
        await registrarAuditoria({
          accion: "auto_vencida_cotizacion",
          modulo: "cotizaciones",
          idDocumento: docSnap.id,
          folio: data.folio,
        });
        marcadas++;
      }
    }
    if (marcadas > 0) invalidarPrefijo("dashboard");
    return { marcadas };
  } catch (err) {
    console.error("Error revisando cotizaciones vencidas:", err);
    return { marcadas: 0, error: err.message };
  }
}
