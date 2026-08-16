/**
 * modules/pagos.js — Pagos y pagos parciales (secciones 34-36).
 * Una orden puede tener N pagos. El saldo SIEMPRE se recalcula sumando
 * todos los pagos reales de Firestore (nunca se confía en un campo
 * "saldo" editado a mano) — así nunca queda negativo por accidente.
 */
import {
  collection,
  doc,
  addDoc,
  getDoc,
  updateDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit as fsLimit,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db, auth, FIREBASE_CONFIGURED } from "../firebase.js";
import { registrarAuditoria } from "../audit.js";
import { calcularSaldo } from "../utils.js";
import { invalidarPrefijo } from "../cache.js";

const METODOS_PAGO = ["efectivo", "transferencia", "tarjeta", "deposito", "otro"];

function validarPago(datos) {
  const errores = [];
  if (!datos.ordenId) errores.push("Debes indicar a qué orden pertenece el pago.");
  if (!Number(datos.importe) || Number(datos.importe) <= 0) errores.push("El importe debe ser mayor a cero.");
  if (!METODOS_PAGO.includes(datos.metodo)) errores.push("Método de pago inválido.");
  return errores;
}

export async function totalPagadoDeOrden(ordenId) {
  if (!FIREBASE_CONFIGURED) return 0;
  const q = query(collection(db, "pagos"), where("ordenId", "==", ordenId));
  const snap = await getDocs(q);
  return snap.docs.reduce((acc, d) => acc + (Number(d.data().importe) || 0), 0);
}

/**
 * Registra un pago y actualiza el saldo de la orden en una transacción.
 * Si el pago excede el saldo pendiente, exige `forzar:true` (confirmación
 * administrativa explícita) — sección 35.
 */
export async function registrarPago(datos, { forzar = false } = {}) {
  if (!FIREBASE_CONFIGURED) return { ok: false, error: "Firebase no configurado." };
  const errores = validarPago(datos);
  if (errores.length) return { ok: false, error: errores.join(" ") };

  const importe = Number(datos.importe);
  const ordenRef = doc(db, "ordenes", datos.ordenId);

  try {
    const resultado = await runTransaction(db, async (tx) => {
      const ordenSnap = await tx.get(ordenRef);
      if (!ordenSnap.exists()) throw new Error("ORDEN_NO_EXISTE");
      const orden = ordenSnap.data();

      const saldoActual = Number(orden.saldo);

      if (importe > saldoActual && !forzar) {
        throw new Error("EXCEDE_SALDO");
      }

      const nuevoSaldo = calcularSaldo(saldoActual, importe);
      const nuevoAnticipo = Number(orden.total) - nuevoSaldo;

      const pagoRef = doc(collection(db, "pagos"));
      tx.set(pagoRef, {
        ordenId: datos.ordenId,
        ordenFolio: orden.folio,
        clienteId: orden.clienteId,
        clienteNombre: orden.clienteNombre,
        importe,
        metodo: datos.metodo,
        observaciones: datos.observaciones || "",
        usuarioUid: auth.currentUser?.uid || null,
        usuarioEmail: auth.currentUser?.email || "",
        fecha: serverTimestamp(),
      });

      tx.update(ordenRef, { saldo: nuevoSaldo, anticipo: nuevoAnticipo });

      return { saldoAnterior: saldoActual, saldoNuevo: nuevoSaldo, folio: orden.folio };
    });

    await registrarAuditoria({
      accion: "registrar_pago",
      modulo: "pagos",
      folio: resultado.folio,
      idDocumento: datos.ordenId,
      datos: { importe, metodo: datos.metodo, saldoNuevo: resultado.saldoNuevo },
    });

    invalidarPrefijo("dashboard");
    return { ok: true, ...resultado };
  } catch (err) {
    if (err.message === "ORDEN_NO_EXISTE") {
      return { ok: false, error: "La orden no existe. No se modificó el saldo." };
    }
    if (err.message === "EXCEDE_SALDO") {
      return {
        ok: false,
        error: "El importe supera el saldo pendiente. Confirma para registrarlo de todas formas.",
        requiereConfirmacion: true,
      };
    }
    console.error("Error registrando pago:", err);
    return { ok: false, error: "No fue posible registrar el pago. No se modificó el saldo." };
  }
}

export async function listarPagosDeOrden(ordenId) {
  if (!FIREBASE_CONFIGURED) return [];
  try {
    const q = query(collection(db, "pagos"), where("ordenId", "==", ordenId), orderBy("fecha", "desc"));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("Error listando pagos de la orden:", err);
    return [];
  }
}

export async function listarPagos({ metodo = null, limite = 100 } = {}) {
  if (!FIREBASE_CONFIGURED) return [];
  try {
    const condiciones = [orderBy("fecha", "desc"), fsLimit(limite)];
    let q = query(collection(db, "pagos"), ...condiciones);
    if (metodo) q = query(collection(db, "pagos"), where("metodo", "==", metodo), ...condiciones);
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("Error listando pagos:", err);
    return [];
  }
}
