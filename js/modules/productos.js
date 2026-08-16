/**
 * modules/productos.js — Inventario real (sección 25-27).
 * El stock NUNCA se edita directo: siempre pasa por registrarMovimiento(),
 * que usa una transacción para que stock y el registro del movimiento
 * queden consistentes incluso si dos personas venden al mismo tiempo.
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
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db, auth, FIREBASE_CONFIGURED } from "../firebase.js";
import { registrarAuditoria } from "../audit.js";
import { invalidarPrefijo } from "../cache.js";

function validarProducto(datos) {
  const errores = [];
  if (!datos.nombre || datos.nombre.trim().length < 2) errores.push("El nombre del producto es obligatorio.");
  if (!datos.sku || datos.sku.trim().length < 1) errores.push("El SKU/código es obligatorio.");
  if (Number(datos.precio) < 0) errores.push("El precio no puede ser negativo.");
  if (Number(datos.costo) < 0) errores.push("El costo no puede ser negativo.");
  if (Number(datos.stockMinimo) < 0) errores.push("El stock mínimo no puede ser negativo.");
  return errores;
}

export async function crearProducto(datos) {
  if (!FIREBASE_CONFIGURED) return { ok: false, error: "Firebase no configurado." };
  const errores = validarProducto(datos);
  if (errores.length) return { ok: false, error: errores.join(" ") };

  try {
    const ref = await addDoc(collection(db, "productos"), {
      sku: datos.sku.trim(),
      nombre: datos.nombre.trim(),
      categoria: datos.categoria || "",
      marca: datos.marca || "",
      descripcion: datos.descripcion || "",
      costo: Number(datos.costo) || 0,
      precio: Number(datos.precio) || 0,
      ivaAplica: datos.ivaAplica !== false,
      stock: Number(datos.stockInicial) || 0,
      stockMinimo: Number(datos.stockMinimo) || 0,
      unidad: datos.unidad || "pieza",
      proveedor: datos.proveedor || "",
      ubicacion: datos.ubicacion || "",
      activo: true,
      fechaAlta: serverTimestamp(),
    });

    // Movimiento inicial de alta, si trae stock de arranque > 0
    const stockInicial = Number(datos.stockInicial) || 0;
    if (stockInicial > 0) {
      await addDoc(collection(db, "movimientosInventario"), {
        productoId: ref.id,
        tipo: "entrada",
        motivo: "alta_inicial",
        cantidad: stockInicial,
        stockAnterior: 0,
        stockNuevo: stockInicial,
        usuarioUid: auth.currentUser?.uid || null,
        fecha: serverTimestamp(),
      });
    }

    await registrarAuditoria({ accion: "crear_producto", modulo: "inventario", idDocumento: ref.id, datos: { sku: datos.sku } });
    invalidarPrefijo("busqueda:");
    return { ok: true, id: ref.id };
  } catch (err) {
    console.error("Error creando producto:", err);
    return { ok: false, error: "No fue posible guardar el producto. Verifica tu conexión e inténtalo de nuevo." };
  }
}

export async function editarProducto(id, datos) {
  if (!FIREBASE_CONFIGURED) return { ok: false, error: "Firebase no configurado." };
  const errores = validarProducto(datos);
  if (errores.length) return { ok: false, error: errores.join(" ") };

  try {
    await updateDoc(doc(db, "productos", id), {
      sku: datos.sku.trim(),
      nombre: datos.nombre.trim(),
      categoria: datos.categoria || "",
      marca: datos.marca || "",
      descripcion: datos.descripcion || "",
      costo: Number(datos.costo) || 0,
      precio: Number(datos.precio) || 0,
      ivaAplica: datos.ivaAplica !== false,
      stockMinimo: Number(datos.stockMinimo) || 0,
      unidad: datos.unidad || "pieza",
      proveedor: datos.proveedor || "",
      ubicacion: datos.ubicacion || "",
      actualizadoEn: serverTimestamp(),
    });
    await registrarAuditoria({ accion: "editar_producto", modulo: "inventario", idDocumento: id });
    invalidarPrefijo("busqueda:");
    return { ok: true };
  } catch (err) {
    console.error("Error editando producto:", err);
    return { ok: false, error: "No fue posible guardar los cambios." };
  }
}

export async function desactivarProducto(id) {
  if (!FIREBASE_CONFIGURED) return { ok: false, error: "Firebase no configurado." };
  try {
    await updateDoc(doc(db, "productos", id), { activo: false, desactivadoEn: serverTimestamp() });
    await registrarAuditoria({ accion: "desactivar_producto", modulo: "inventario", idDocumento: id });
    return { ok: true };
  } catch (err) {
    console.error("Error desactivando producto:", err);
    return { ok: false, error: "No fue posible desactivar el producto." };
  }
}

export async function listarProductos({ soloActivos = true, limite = 200 } = {}) {
  if (!FIREBASE_CONFIGURED) return [];
  try {
    let q = query(collection(db, "productos"), orderBy("nombre"), fsLimit(limite));
    if (soloActivos) {
      q = query(collection(db, "productos"), where("activo", "==", true), orderBy("nombre"), fsLimit(limite));
    }
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("Error listando productos:", err);
    return [];
  }
}

export async function obtenerProducto(id) {
  if (!FIREBASE_CONFIGURED) return null;
  const snap = await getDoc(doc(db, "productos", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Registra un movimiento de inventario (entrada/salida/ajuste) y actualiza
 * el stock en la MISMA transacción — evita condiciones de carrera.
 *
 * @param {Object} p
 * @param {string} p.productoId
 * @param {'entrada'|'salida'|'ajuste'} p.tipo
 * @param {number} p.cantidad  siempre positivo; el signo lo decide `tipo`
 * @param {string} [p.motivo]
 * @param {string} [p.folioOrden] si viene de una orden, para trazabilidad y para evitar doble descuento
 */
export async function registrarMovimiento({ productoId, tipo, cantidad, motivo = "", folioOrden = null }) {
  if (!FIREBASE_CONFIGURED) return { ok: false, error: "Firebase no configurado." };
  const cant = Number(cantidad);
  if (!["entrada", "salida", "ajuste"].includes(tipo)) {
    return { ok: false, error: "Tipo de movimiento inválido." };
  }
  // Un "ajuste" fija el stock EXACTO — 0 es un valor válido (ej. "ya no
  // queda nada de este producto"). Entrada/salida SIEMPRE mueven una
  // cantidad positiva; mover "0 unidades" no tiene sentido de negocio.
  if (tipo === "ajuste") {
    if (cant < 0 || Number.isNaN(cant)) return { ok: false, error: "El ajuste de stock no puede ser negativo." };
  } else if (!cant || cant <= 0) {
    return { ok: false, error: "La cantidad debe ser mayor a cero." };
  }

  try {
    const productoRef = doc(db, "productos", productoId);
    const resultado = await runTransaction(db, async (tx) => {
      const snap = await tx.get(productoRef);
      if (!snap.exists()) throw new Error("El producto no existe.");
      const stockActual = Number(snap.data().stock) || 0;

      let stockNuevo;
      if (tipo === "entrada") stockNuevo = stockActual + cant;
      else if (tipo === "salida") stockNuevo = stockActual - cant;
      else stockNuevo = cant; // ajuste: establece el stock al valor indicado

      if (stockNuevo < 0) {
        throw new Error("STOCK_INSUFICIENTE");
      }

      tx.update(productoRef, { stock: stockNuevo });
      const movRef = doc(collection(db, "movimientosInventario"));
      tx.set(movRef, {
        productoId,
        tipo,
        motivo,
        cantidad: cant,
        stockAnterior: stockActual,
        stockNuevo,
        folioOrden,
        usuarioUid: auth.currentUser?.uid || null,
        fecha: serverTimestamp(),
      });
      return { stockAnterior: stockActual, stockNuevo };
    });

    await registrarAuditoria({
      accion: `movimiento_inventario_${tipo}`,
      modulo: "inventario",
      idDocumento: productoId,
      folio: folioOrden,
      datos: { cantidad: cant, ...resultado },
    });

    return { ok: true, ...resultado };
  } catch (err) {
    if (err.message === "STOCK_INSUFICIENTE") {
      return { ok: false, error: "No hay stock suficiente para esta salida." };
    }
    console.error("Error registrando movimiento de inventario:", err);
    return { ok: false, error: "No fue posible registrar el movimiento. No se modificó el stock." };
  }
}

/**
 * Evita descontar dos veces el inventario de la misma orden (sección 26).
 * Se consulta si ya existe un movimiento de tipo "salida" con ese folioOrden
 * ANTES de llamar a registrarMovimiento desde ordenes.js.
 */
export async function yaSeDescontoInventario(folioOrden) {
  if (!FIREBASE_CONFIGURED || !folioOrden) return false;
  const q = query(
    collection(db, "movimientosInventario"),
    where("folioOrden", "==", folioOrden),
    where("tipo", "==", "salida")
  );
  const snap = await getDocs(q);
  return !snap.empty;
}

export async function historialMovimientos(productoId, limite = 50) {
  if (!FIREBASE_CONFIGURED) return [];
  try {
    const q = query(
      collection(db, "movimientosInventario"),
      where("productoId", "==", productoId),
      orderBy("fecha", "desc"),
      fsLimit(limite)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("Error obteniendo historial de movimientos:", err);
    return [];
  }
}
