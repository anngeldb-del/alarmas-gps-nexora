/**
 * cache.js — Caché en memoria con TTL, para reducir lecturas repetidas
 * de Firestore en datos que no cambian a cada segundo (listas para
 * dropdowns, resultados de búsqueda, etc.).
 *
 * ⚠️ Se pierde al recargar la página (no usa localStorage a propósito —
 * ver restricciones de artifacts, y porque los datos de negocio no deben
 * quedar obsoletos por mucho tiempo). Es solo para evitar ráfagas de
 * lecturas repetidas dentro de la misma sesión de uso.
 */
const almacen = new Map(); // clave -> { valor, expiraEn }

/**
 * @param {string} clave
 * @param {() => Promise<any>} fnCargar  función que trae el dato real si no hay caché válida
 * @param {number} ttlMs  cuánto dura la caché (default 30s)
 */
export async function conCache(clave, fnCargar, ttlMs = 30000) {
  const entrada = almacen.get(clave);
  if (entrada && entrada.expiraEn > Date.now()) {
    return entrada.valor;
  }
  const valor = await fnCargar();
  almacen.set(clave, { valor, expiraEn: Date.now() + ttlMs });
  return valor;
}

/** Invalida una clave específica (llamar después de crear/editar/borrar). */
export function invalidar(clave) {
  almacen.delete(clave);
}

/** Invalida todas las claves que empiecen con un prefijo (ej. "clientes:"). */
export function invalidarPrefijo(prefijo) {
  [...almacen.keys()].forEach((k) => {
    if (k.startsWith(prefijo)) almacen.delete(k);
  });
}
