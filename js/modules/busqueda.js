/**
 * modules/busqueda.js — Búsqueda global (sección 47).
 * Firestore no tiene búsqueda de texto libre nativa; para el volumen de
 * datos de un negocio de este tamaño, se trae una página razonable de
 * cada colección y se filtra por substring en el cliente. Si el negocio
 * crece mucho, esto se puede migrar a Algolia/Typesense sin tocar la UI
 * (solo cambiar la implementación de buscarGlobal).
 */
import { listarClientes } from "./clientes.js";
import { listarOrdenes } from "./ordenes.js";
import { listarCotizaciones } from "./cotizaciones.js";
import { listarProductos } from "./productos.js";
import { conCache } from "../cache.js";

function coincide(texto, termino) {
  return String(texto || "").toLowerCase().includes(termino);
}

export async function buscarGlobal(termino) {
  const t = termino.trim().toLowerCase();
  if (t.length < 2) return { clientes: [], ordenes: [], cotizaciones: [], productos: [] };

  // Caché de 20s: si buscas "jua" y luego "juan" en pocos segundos, la
  // segunda búsqueda reutiliza las mismas listas ya traídas en vez de
  // volver a leerlas de Firestore.
  const [clientes, ordenes, cotizaciones, productos] = await Promise.all([
    conCache("busqueda:clientes", () => listarClientes({ soloActivos: true, limite: 150 }), 20000),
    conCache("busqueda:ordenes", () => listarOrdenes({ limite: 150 }), 20000),
    conCache("busqueda:cotizaciones", () => listarCotizaciones({ limite: 150 }), 20000),
    conCache("busqueda:productos", () => listarProductos({ soloActivos: true, limite: 150 }), 20000),
  ]);

  return {
    clientes: clientes
      .filter((c) => coincide(c.nombre, t) || coincide(c.telefono, t) || coincide(c.whatsapp, t) || coincide(c.email, t))
      .slice(0, 8),
    ordenes: ordenes
      .filter((o) => coincide(o.folio, t) || coincide(o.clienteNombre, t) || coincide(o.placas, t) || coincide(o.unidad, t))
      .slice(0, 8),
    cotizaciones: cotizaciones
      .filter((c) => coincide(c.folio, t) || coincide(c.clienteNombre, t))
      .slice(0, 8),
    productos: productos
      .filter((p) => coincide(p.nombre, t) || coincide(p.sku, t))
      .slice(0, 8),
  };
}
