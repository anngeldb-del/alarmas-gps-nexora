/**
 * modules/clientes.js — CRUD completo y real (sección 19-20).
 * Nada de datos falsos permanentes: si Firestore está vacío, la UI debe
 * mostrar el estado vacío profesional (ver dashboard.js / index.html).
 */
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  limit as fsLimit,
  startAfter,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db, FIREBASE_CONFIGURED } from "../firebase.js";
import { registrarAuditoria } from "../audit.js";
import { invalidarPrefijo } from "../cache.js";
import { validarEmail, validarTelefono } from "../utils.js";

function validarCliente(datos) {
  const errores = [];
  if (!datos.nombre || datos.nombre.trim().length < 2) {
    errores.push("El nombre / razón social es obligatorio.");
  }
  if (datos.telefono && !validarTelefono(datos.telefono)) {
    errores.push("El teléfono debe tener al menos 10 dígitos.");
  }
  if (datos.email && !validarEmail(datos.email)) {
    errores.push("El correo electrónico no es válido.");
  }
  return errores;
}

export async function crearCliente(datos) {
  if (!FIREBASE_CONFIGURED) return { ok: false, error: "Firebase no configurado." };
  const errores = validarCliente(datos);
  if (errores.length) return { ok: false, error: errores.join(" ") };

  try {
    const ref = await addDoc(collection(db, "clientes"), {
      nombre: datos.nombre.trim(),
      telefono: datos.telefono || "",
      whatsapp: datos.whatsapp || datos.telefono || "",
      email: datos.email || "",
      direccion: datos.direccion || "",
      rfc: datos.rfc || "",
      contacto: datos.contacto || "",
      notas: datos.notas || "",
      saldoPendiente: 0,
      activo: true,
      fechaRegistro: serverTimestamp(),
    });
    await registrarAuditoria({
      accion: "crear_cliente",
      modulo: "clientes",
      idDocumento: ref.id,
      datos: { nombre: datos.nombre },
    });
    invalidarPrefijo("busqueda:");
    return { ok: true, id: ref.id };
  } catch (err) {
    console.error("Error creando cliente:", err);
    return {
      ok: false,
      error: "No fue posible guardar el cliente. Verifica tu conexión e inténtalo de nuevo.",
    };
  }
}

export async function editarCliente(id, datos) {
  if (!FIREBASE_CONFIGURED) return { ok: false, error: "Firebase no configurado." };
  const errores = validarCliente(datos);
  if (errores.length) return { ok: false, error: errores.join(" ") };

  try {
    const ref = doc(db, "clientes", id);
    await updateDoc(ref, {
      nombre: datos.nombre.trim(),
      telefono: datos.telefono || "",
      whatsapp: datos.whatsapp || datos.telefono || "",
      email: datos.email || "",
      direccion: datos.direccion || "",
      rfc: datos.rfc || "",
      contacto: datos.contacto || "",
      notas: datos.notas || "",
      actualizadoEn: serverTimestamp(),
    });
    await registrarAuditoria({ accion: "editar_cliente", modulo: "clientes", idDocumento: id });
    invalidarPrefijo("busqueda:");
    return { ok: true };
  } catch (err) {
    console.error("Error editando cliente:", err);
    return { ok: false, error: "No fue posible guardar los cambios." };
  }
}

// Nunca eliminar físicamente (sección 49) — solo desactivar.
export async function desactivarCliente(id) {
  if (!FIREBASE_CONFIGURED) return { ok: false, error: "Firebase no configurado." };
  try {
    await updateDoc(doc(db, "clientes", id), { activo: false, desactivadoEn: serverTimestamp() });
    await registrarAuditoria({ accion: "desactivar_cliente", modulo: "clientes", idDocumento: id });
    return { ok: true };
  } catch (err) {
    console.error("Error desactivando cliente:", err);
    return { ok: false, error: "No fue posible desactivar el cliente." };
  }
}

export async function obtenerCliente(id) {
  if (!FIREBASE_CONFIGURED) return null;
  const snap = await getDoc(doc(db, "clientes", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Lista clientes. Paginado simple con `limite` (sección 64 — nunca
 * traer toda la colección de golpe).
 */
/**
 * Versión paginada para listas largas (sección 64 — no bajar todo de
 * golpe). Devuelve una página y el cursor para pedir la siguiente.
 * @param {{soloActivos?:boolean, cursor?:any, tamanoPagina?:number}} opts
 */
export async function listarClientesPaginado({ soloActivos = true, cursor = null, tamanoPagina = 30 } = {}) {
  if (!FIREBASE_CONFIGURED) return { items: [], cursor: null, hayMas: false };
  try {
    const base = soloActivos
      ? [collection(db, "clientes"), where("activo", "==", true), orderBy("nombre")]
      : [collection(db, "clientes"), orderBy("nombre")];
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
    console.error("Error paginando clientes:", err);
    return { items: [], cursor: null, hayMas: false };
  }
}

export async function listarClientes({ soloActivos = true, limite = 50 } = {}) {
  if (!FIREBASE_CONFIGURED) return [];
  try {
    let q = query(collection(db, "clientes"), orderBy("nombre"), fsLimit(limite));
    if (soloActivos) {
      q = query(
        collection(db, "clientes"),
        where("activo", "==", true),
        orderBy("nombre"),
        fsLimit(limite)
      );
    }
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("Error listando clientes:", err);
    return [];
  }
}
