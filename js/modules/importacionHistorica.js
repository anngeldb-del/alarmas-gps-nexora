/**
 * modules/importacionHistorica.js
 * Importador dedicado al layout REAL de AlarmasReset-*.xlsx (3 hojas:
 * Órdenes, Servicios, Resumen) — descubierto al analizar el archivo que
 * Angel subió, distinto del importador genérico de clientes.
 *
 * Decisiones de mapeo (confirmadas con Angel):
 * - Orden con Estado="PAGADO" en el Excel → estado "entregada" en el
 *   sistema nuevo (trabajo terminado y cobrado, no aparece como pendiente).
 * - Orden con Estado="PENDIENTE" → estado "pendiente".
 * - Cada fila de "Servicios" se vuelve un concepto de la orden, con los
 *   campos extra `inversion`, `ganancia` y `garantia` (el motor de
 *   cálculo de totales solo usa cantidad×precio, así que estos campos
 *   adicionales no rompen nada — solo se guardan para trazabilidad y
 *   reportes de utilidad real por servicio).
 * - El Total/Saldo del Excel se respeta tal cual (no se recalcula IVA
 *   sobre datos históricos — estos ya son importes reales cobrados).
 * - Se genera un registro de pago por cada orden con Total-Saldo > 0,
 *   fechado con F. Pago (o F. Instalación si no hay F. Pago), para que
 *   los reportes de meses anteriores salgan correctos.
 * - Los clientes se crean por nombre único; si el nombre ya existe en
 *   `clientes`, se reutiliza ese cliente (no se duplica).
 */
import {
  collection,
  doc,
  writeBatch,
  Timestamp,
  increment,
  query,
  where,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db, FIREBASE_CONFIGURED } from "../firebase.js";
import { registrarAuditoria } from "../audit.js";
import { leerTodasLasHojas } from "../excel.js";
import { generarFolio } from "../folios.js";

function normalizarNombre(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function filasComoObjetos(filasCrudas) {
  const [encabezados, ...filas] = filasCrudas;
  return filas
    .filter((f) => f.some((celda) => String(celda).trim() !== ""))
    .map((fila) => {
      const obj = {};
      encabezados.forEach((h, i) => (obj[String(h).trim()] = fila[i]));
      return obj;
    });
}

function parseFechaExcel(valor) {
  if (!valor) return null;
  const d = new Date(valor);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * @param {File} archivo
 * @returns {Promise<{ok:boolean, ordenesRaw?, serviciosRaw?, error?}>}
 */
export async function procesarArchivoHistorico(archivo) {
  const r = await leerTodasLasHojas(archivo);
  if (!r.ok) return r;

  const hojaOrdenes = r.nombresHojas.find((n) => n.toLowerCase().includes("orden"));
  const hojaServicios = r.nombresHojas.find((n) => n.toLowerCase().includes("servicio"));

  if (!hojaOrdenes || !hojaServicios) {
    return {
      ok: false,
      error: `Este archivo no tiene el formato esperado (hojas "Órdenes" y "Servicios"). Hojas encontradas: ${r.nombresHojas.join(", ")}.`,
    };
  }

  const ordenesRaw = filasComoObjetos(r.hojas[hojaOrdenes]);
  const serviciosRaw = filasComoObjetos(r.hojas[hojaServicios]);

  return { ok: true, ordenesRaw, serviciosRaw };
}

/**
 * Prepara el plan de importación (sin escribir nada todavía) para que
 * la UI muestre un resumen antes de confirmar.
 */
/**
 * Devuelve el conjunto de `origenExcelId` que YA fueron importados
 * anteriormente — evita duplicar todo (clientes, órdenes, pagos y el
 * contador de estadísticas) si el importador se corre dos veces por error.
 * Consulta barata: solo trae órdenes marcadas `importadoDeExcel==true`
 * (un conjunto pequeño y acotado, no la colección completa).
 */
export async function obtenerIdsYaImportados() {
  if (!FIREBASE_CONFIGURED) return new Set();
  try {
    const q = query(collection(db, "ordenes"), where("importadoDeExcel", "==", true));
    const snap = await getDocs(q);
    return new Set(snap.docs.map((d) => d.data().origenExcelId).filter(Boolean));
  } catch (err) {
    console.warn("No se pudo verificar qué ya se había importado:", err);
    return new Set();
  }
}

export function prepararPlanImportacion(ordenesRaw, serviciosRaw, clientesExistentes = [], idsYaImportados = new Set()) {
  const nombresExistentes = new Map(
    clientesExistentes.map((c) => [normalizarNombre(c.nombre), c.id])
  );

  const clientesNuevos = new Map(); // nombre_normalizado -> nombre_original
  const erroresOrdenes = [];
  const ordenesPlan = [];
  let yaImportadasOmitidas = 0;

  ordenesRaw.forEach((o, idx) => {
    const idOrigen = String(o["ID"] || "");
    if (idOrigen && idsYaImportados.has(idOrigen)) {
      yaImportadasOmitidas++;
      return; // ya se importó en una corrida anterior — no duplicar
    }

    const nombreCliente = String(o["Cliente"] || "").trim();
    if (!nombreCliente) {
      erroresOrdenes.push({ fila: idx + 2, motivo: "Sin cliente" });
      return;
    }
    const clave = normalizarNombre(nombreCliente);
    if (!nombresExistentes.has(clave) && !clientesNuevos.has(clave)) {
      clientesNuevos.set(clave, nombreCliente);
    }

    const conceptos = serviciosRaw
      .filter((s) => String(s["ID Orden"]) === String(o["ID"]))
      .map((s) => ({
        descripcion: String(s["Servicio"] || "Servicio"),
        cantidad: 1,
        precio: Number(s["Costo"]) || 0,
        productoId: null,
        inversion: Number(s["Inversión"]) || 0,
        ganancia: Number(s["Ganancia"]) || 0,
        garantia: String(s["Garantía"] || "Sin garantía"),
      }));

    const total = Number(o["Total"]) || 0;
    const aCuenta = Number(o["A Cuenta"]) || 0;
    const saldoExcel = Number(o["Saldo"]) || Math.max(total - aCuenta, 0);
    const estadoExcel = String(o["Estado"] || "").toUpperCase();
    const estadoDestino = estadoExcel === "PAGADO" ? "entregada" : "pendiente";

    // ⚠️ Hallazgo del análisis: en el Excel origen, "Saldo" = Total - A Cuenta
    // SIEMPRE, incluso cuando Estado="PAGADO" (no baja a 0 al cobrarse el
    // resto). El indicador real de "ya se cobró todo" es el Estado, no el
    // Saldo. Por eso: si la orden llega como "entregada" (PAGADO), se
    // considera pagada al 100% (saldo=0, anticipo=total). Si llega como
    // "pendiente", se respeta el Saldo real del Excel.
    const saldo = estadoDestino === "entregada" ? 0 : saldoExcel;
    const anticipo = total - saldo;
    const montoPagado = anticipo; // lo que se registrará como pago histórico

    ordenesPlan.push({
      origenExcelId: String(o["ID"] || ""),
      clienteNombreClave: clave,
      clienteNombre: nombreCliente,
      vehiculo: String(o["Vehículo"] || ""),
      fechaInstalacion: parseFechaExcel(o["F. Instalación"]),
      fechaPago: parseFechaExcel(o["F. Pago"]),
      notas: o["Notas"] && String(o["Notas"]) !== "NaN" ? String(o["Notas"]) : "",
      total,
      anticipo,
      saldo,
      montoPagado,
      estadoDestino,
      conceptos,
    });
  });

  return {
    totalOrdenes: ordenesRaw.length,
    ordenesValidas: ordenesPlan.length,
    yaImportadasOmitidas,
    erroresOrdenes,
    clientesNuevosCount: clientesNuevos.size,
    clientesExistentesReutilizados: ordenesPlan.filter((p) => nombresExistentes.has(p.clienteNombreClave)).length,
    totalConceptos: ordenesPlan.reduce((acc, p) => acc + p.conceptos.length, 0),
    totalAImportarComoIngreso: ordenesPlan.reduce((acc, p) => acc + p.montoPagado, 0),
    // datos para ejecutar:
    _clientesNuevos: clientesNuevos,
    _ordenesPlan: ordenesPlan,
    _nombresExistentes: nombresExistentes,
  };
}

/**
 * Ejecuta la importación real: crea clientes nuevos, órdenes con fecha
 * histórica real, y un pago por cada orden con monto pagado > 0.
 * Todo en lotes (writeBatch) para no exceder límites de Firestore.
 */
export async function ejecutarImportacionHistorica(plan) {
  if (!FIREBASE_CONFIGURED) return { ok: false, error: "Firebase no configurado." };

  try {
    // 1) Crear clientes nuevos primero (necesitamos sus IDs para las órdenes)
    const idsClientePorClave = new Map(plan._nombresExistentes);
    const clientesEntries = [...plan._clientesNuevos.entries()];

    for (let i = 0; i < clientesEntries.length; i += 400) {
      const trozo = clientesEntries.slice(i, i + 400);
      const batch = writeBatch(db);
      const refsTemp = [];
      trozo.forEach(([clave, nombre]) => {
        const ref = doc(collection(db, "clientes"));
        batch.set(ref, {
          nombre,
          telefono: "",
          whatsapp: "",
          email: "",
          direccion: "",
          rfc: "",
          notas: "",
          saldoPendiente: 0,
          activo: true,
          fechaRegistro: Timestamp.now(),
          importadoDeExcel: true,
        });
        refsTemp.push([clave, ref.id]);
      });
      await batch.commit();
      refsTemp.forEach(([clave, id]) => idsClientePorClave.set(clave, id));
    }

    // 2) Crear órdenes + pagos, en lotes de ~200 órdenes (cada una puede
    // sumar 1-2 escrituras: orden + pago)
    let ordenesCreadas = 0;
    let pagosCreados = 0;
    const ORDENES_POR_LOTE = 200;

    for (let i = 0; i < plan._ordenesPlan.length; i += ORDENES_POR_LOTE) {
      const trozo = plan._ordenesPlan.slice(i, i + ORDENES_POR_LOTE);
      const batch = writeBatch(db);
      let sumaEntregadasLote = 0;
      let cantidadEntregadasLote = 0;

      for (const o of trozo) {
        const folioResp = await generarFolio("orden"); // transaccional, fuera del batch
        if (!folioResp.ok) {
          return { ok: false, error: `Falló al generar folio: ${folioResp.error}`, ordenesCreadas, pagosCreados };
        }

        const clienteId = idsClientePorClave.get(o.clienteNombreClave) || null;
        const fechaOrden = o.fechaInstalacion ? Timestamp.fromDate(o.fechaInstalacion) : Timestamp.now();

        const ordenRef = doc(collection(db, "ordenes"));
        batch.set(ordenRef, {
          folio: folioResp.folio,
          clienteId,
          clienteNombre: o.clienteNombre,
          telefono: "",
          vehiculo: o.vehiculo,
          marca: "",
          modelo: "",
          anio: "",
          placas: "",
          unidad: "",
          numeroSerie: "",
          descripcion: "",
          conceptos: o.conceptos,
          descuento: 0,
          subtotal: o.total,
          subtotalNeto: o.total,
          iva: 0,
          total: o.total,
          anticipo: o.anticipo,
          saldo: o.saldo,
          tecnicoUid: null,
          tecnicoNombre: "",
          estado: o.estadoDestino,
          fechaEstimada: null,
          fechaReal: o.estadoDestino === "entregada" ? fechaOrden : null,
          observaciones: o.notas,
          cotizacionOrigenId: null,
          fecha: fechaOrden,
          origenExcelId: o.origenExcelId,
          importadoDeExcel: true,
        });
        ordenesCreadas++;

        if (o.estadoDestino === "entregada") {
          sumaEntregadasLote += Number(o.total) || 0;
          cantidadEntregadasLote += 1;
        }

        if (o.montoPagado > 0) {
          const fechaPago = o.fechaPago ? Timestamp.fromDate(o.fechaPago) : fechaOrden;
          const pagoRef = doc(collection(db, "pagos"));
          batch.set(pagoRef, {
            ordenId: ordenRef.id,
            ordenFolio: folioResp.folio,
            clienteId,
            clienteNombre: o.clienteNombre,
            importe: o.montoPagado,
            metodo: "efectivo",
            observaciones: "Importado del historial Excel (método real no registrado en el origen)",
            usuarioUid: null,
            usuarioEmail: "importacion",
            fecha: fechaPago,
            importadoDeExcel: true,
          });
          pagosCreados++;
        }
      }

      if (cantidadEntregadasLote > 0) {
        batch.set(
          doc(db, "estadisticas", "global"),
          {
            sumaTotalEntregadas: increment(sumaEntregadasLote),
            cantidadEntregadas: increment(cantidadEntregadasLote),
            actualizadoEn: Timestamp.now(),
          },
          { merge: true }
        );
      }

      await batch.commit();
    }

    await registrarAuditoria({
      accion: "importar_historico_excel",
      modulo: "importacion",
      datos: { ordenesCreadas, pagosCreados, clientesNuevos: clientesEntries.length },
    });

    return { ok: true, ordenesCreadas, pagosCreados, clientesCreados: clientesEntries.length };
  } catch (err) {
    console.error("Error en importación histórica:", err);
    return {
      ok: false,
      error: `La importación se detuvo por un error. Revisa qué quedó guardado antes de reintentar. Detalle: ${err.message}`,
    };
  }
}
