/**
 * modules/importacion.js — Importación desde Excel (sección 45).
 * ⚠️ Angel aún no ha subido `AlarmasReset-2026-08-13.xlsx`, así que este
 * importador está construido de forma GENÉRICA para la colección más
 * universal (clientes): el usuario mapea manualmente qué columna del
 * Excel corresponde a qué campo. En cuanto tengamos el Excel real,
 * extendemos esto con mapeos predefinidos por columna para
 * órdenes/productos/pagos sin tener que rehacer la arquitectura.
 *
 * Flujo (igual al pedido en el brief): seleccionar → previsualizar 10
 * filas → mapear columnas → detectar duplicados/errores → resumen →
 * confirmar → importar con batch writes → resultado final.
 */
import {
  collection,
  writeBatch,
  doc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db, FIREBASE_CONFIGURED } from "../firebase.js";
import { registrarAuditoria } from "../audit.js";
import { leerArchivoExcel } from "../excel.js";
import { validarEmail, validarTelefono } from "../utils.js";

/**
 * Normaliza un nombre para comparar duplicados: quita acentos, pasa a
 * minúsculas y colapsa espacios extra. Así "José Pérez", "jose perez" y
 * "JOSÉ  PÉREZ" (con doble espacio) se detectan como el mismo duplicado.
 */
function normalizarNombre(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita acentos/diacríticos
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " "); // colapsa espacios múltiples
}

export const CAMPOS_IMPORTABLES_CLIENTES = [
  { campo: "nombre", etiqueta: "Nombre / razón social", obligatorio: true },
  { campo: "telefono", etiqueta: "Teléfono", obligatorio: false },
  { campo: "email", etiqueta: "Email", obligatorio: false },
  { campo: "direccion", etiqueta: "Dirección", obligatorio: false },
  { campo: "rfc", etiqueta: "RFC", obligatorio: false },
  { campo: "notas", etiqueta: "Notas", obligatorio: false },
];

/**
 * @param {File} archivo
 * @returns {Promise<{ok:boolean, encabezados?:string[], filas?:Array, previa?:Array, error?:string}>}
 */
export async function procesarArchivo(archivo) {
  const r = await leerArchivoExcel(archivo);
  if (!r.ok) return r;

  const [encabezados, ...filas] = r.filas;
  if (!encabezados || filas.length === 0) {
    return { ok: false, error: "El archivo no tiene datos o no tiene encabezados en la primera fila." };
  }

  return {
    ok: true,
    encabezados,
    filas,
    previa: filas.slice(0, 10),
    totalFilas: filas.length,
  };
}

/**
 * @param {string[]} encabezados
 * @param {Array<Array>} filas
 * @param {Object} mapeo  { nombre: indiceColumna, telefono: indiceColumna, ... }
 * @param {Array<Object>} clientesExistentes  para detectar duplicados
 */
export function validarYPrepararImportacion(encabezados, filas, mapeo, clientesExistentes = []) {
  const validos = [];
  const duplicados = [];
  const errores = [];

  const nombresExistentes = new Set(
    clientesExistentes.map((c) => normalizarNombre(c.nombre))
  );
  const nombresEnEsteLote = new Set();

  filas.forEach((fila, indiceFila) => {
    const registro = {};
    Object.entries(mapeo).forEach(([campo, indiceColumna]) => {
      if (indiceColumna !== "" && indiceColumna != null) {
        registro[campo] = String(fila[indiceColumna] ?? "").trim();
      }
    });

    const erroresFila = [];
    if (!registro.nombre) erroresFila.push("Falta el nombre");
    if (registro.telefono && !validarTelefono(registro.telefono)) erroresFila.push("Teléfono inválido");
    if (registro.email && !validarEmail(registro.email)) erroresFila.push("Email inválido");

    if (erroresFila.length > 0) {
      errores.push({ fila: indiceFila + 2, registro, motivos: erroresFila }); // +2: fila 1 es encabezado
      return;
    }

    const nombreNormalizado = normalizarNombre(registro.nombre);
    if (nombresExistentes.has(nombreNormalizado) || nombresEnEsteLote.has(nombreNormalizado)) {
      duplicados.push({ fila: indiceFila + 2, registro });
      return;
    }

    nombresEnEsteLote.add(nombreNormalizado);
    validos.push(registro);
  });

  return { validos, duplicados, errores };
}

/**
 * Importa en lotes de máx. 450 documentos por batch (límite real de
 * Firestore es 500 — dejamos margen).
 */
export async function ejecutarImportacionClientes(validos) {
  if (!FIREBASE_CONFIGURED) return { ok: false, error: "Firebase no configurado." };
  if (validos.length === 0) return { ok: false, error: "No hay registros válidos para importar." };

  try {
    const LOTE = 450;
    let importados = 0;

    for (let i = 0; i < validos.length; i += LOTE) {
      const trozo = validos.slice(i, i + LOTE);
      const batch = writeBatch(db);
      trozo.forEach((registro) => {
        const ref = doc(collection(db, "clientes"));
        batch.set(ref, {
          nombre: registro.nombre,
          telefono: registro.telefono || "",
          whatsapp: registro.telefono || "",
          email: registro.email || "",
          direccion: registro.direccion || "",
          rfc: registro.rfc || "",
          notas: registro.notas || "",
          saldoPendiente: 0,
          activo: true,
          fechaRegistro: serverTimestamp(),
          importadoDeExcel: true,
        });
      });
      await batch.commit();
      importados += trozo.length;
    }

    await registrarAuditoria({
      accion: "importar_clientes_excel",
      modulo: "importacion",
      datos: { cantidad: importados },
    });

    return { ok: true, importados };
  } catch (err) {
    console.error("Error importando clientes:", err);
    return {
      ok: false,
      error: `Se importaron parcialmente los datos antes de fallar. Revisa el módulo de clientes para ver qué quedó guardado. Detalle: ${err.message}`,
    };
  }
}
