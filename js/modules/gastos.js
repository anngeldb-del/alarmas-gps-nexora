/**
 * modules/gastos.js — Gastos (sección 37). Separado de ingresos por
 * completo: viven en su propia colección y nunca se mezclan en los
 * cálculos de `ingresos.js`. Solo administrador los ve/edita (ver
 * firestore.rules) por ser información financiera sensible del negocio.
 */
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit as fsLimit,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db, FIREBASE_CONFIGURED } from "../firebase.js";
import { registrarAuditoria } from "../audit.js";

export const CATEGORIAS_GASTO = [
  "renta",
  "servicios",
  "sueldos",
  "compra_materiales",
  "combustible",
  "mantenimiento",
  "publicidad",
  "impuestos",
  "otro",
];

export const METODOS_PAGO_GASTO = ["efectivo", "transferencia", "tarjeta", "otro"];

function validarGasto(datos) {
  const errores = [];
  if (!datos.concepto || datos.concepto.trim().length < 2) errores.push("El concepto es obligatorio.");
  if (!Number(datos.importe) || Number(datos.importe) <= 0) errores.push("El importe debe ser mayor a cero.");
  if (!CATEGORIAS_GASTO.includes(datos.categoria)) errores.push("Categoría inválida.");
  return errores;
}

export async function crearGasto(datos) {
  if (!FIREBASE_CONFIGURED) return { ok: false, error: "Firebase no configurado." };
  const errores = validarGasto(datos);
  if (errores.length) return { ok: false, error: errores.join(" ") };

  try {
    const ref = await addDoc(collection(db, "gastos"), {
      concepto: datos.concepto.trim(),
      categoria: datos.categoria,
      importe: Number(datos.importe),
      metodo: datos.metodo || "efectivo",
      proveedor: datos.proveedor || "",
      notas: datos.notas || "",
      activo: true,
      fecha: serverTimestamp(),
    });
    await registrarAuditoria({
      accion: "crear_gasto",
      modulo: "gastos",
      idDocumento: ref.id,
      datos: { importe: Number(datos.importe), categoria: datos.categoria },
    });
    return { ok: true, id: ref.id };
  } catch (err) {
    console.error("Error creando gasto:", err);
    return { ok: false, error: "No fue posible guardar el gasto. Verifica tu conexión e inténtalo de nuevo." };
  }
}

export async function editarGasto(id, datos) {
  if (!FIREBASE_CONFIGURED) return { ok: false, error: "Firebase no configurado." };
  const errores = validarGasto(datos);
  if (errores.length) return { ok: false, error: errores.join(" ") };

  try {
    await updateDoc(doc(db, "gastos", id), {
      concepto: datos.concepto.trim(),
      categoria: datos.categoria,
      importe: Number(datos.importe),
      metodo: datos.metodo || "efectivo",
      proveedor: datos.proveedor || "",
      notas: datos.notas || "",
      actualizadoEn: serverTimestamp(),
    });
    await registrarAuditoria({ accion: "editar_gasto", modulo: "gastos", idDocumento: id });
    return { ok: true };
  } catch (err) {
    console.error("Error editando gasto:", err);
    return { ok: false, error: "No fue posible guardar los cambios." };
  }
}

export async function desactivarGasto(id) {
  if (!FIREBASE_CONFIGURED) return { ok: false, error: "Firebase no configurado." };
  try {
    await updateDoc(doc(db, "gastos", id), { activo: false, desactivadoEn: serverTimestamp() });
    await registrarAuditoria({ accion: "desactivar_gasto", modulo: "gastos", idDocumento: id });
    return { ok: true };
  } catch (err) {
    console.error("Error desactivando gasto:", err);
    return { ok: false, error: "No fue posible desactivar el gasto." };
  }
}

export async function listarGastos({ categoria = null, soloActivos = true, limite = 200 } = {}) {
  if (!FIREBASE_CONFIGURED) return [];
  try {
    const condiciones = [orderBy("fecha", "desc"), fsLimit(limite)];
    let q = query(collection(db, "gastos"), ...condiciones);
    if (categoria) {
      q = query(collection(db, "gastos"), where("categoria", "==", categoria), ...condiciones);
    }
    const snap = await getDocs(q);
    let gastos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (soloActivos) gastos = gastos.filter((g) => g.activo !== false);
    return gastos;
  } catch (err) {
    console.error("Error listando gastos:", err);
    return [];
  }
}

export async function gastosDelRango(desde, hasta) {
  if (!FIREBASE_CONFIGURED) return [];
  try {
    const q = query(
      collection(db, "gastos"),
      where("fecha", ">=", Timestamp.fromDate(desde)),
      where("fecha", "<=", Timestamp.fromDate(hasta)),
      orderBy("fecha", "desc")
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((g) => g.activo !== false);
  } catch (err) {
    console.error("Error listando gastos del rango:", err);
    return [];
  }
}

export function totalGastos(gastos) {
  return gastos.reduce((acc, g) => acc + (Number(g.importe) || 0), 0);
}
