/**
 * excel.js — Exportación a .xlsx real con SheetJS (cargado por CDN en
 * index.html, expone window.XLSX). Genera un libro con varias hojas,
 * anchos de columna razonables y encabezados — nada de CSV disfrazado.
 */

function xlsxDisponible() {
  return typeof window !== "undefined" && window.XLSX;
}

/**
 * @param {Array<{nombre:string, filas:Array<Object>}>} hojas
 * @param {string} nombreArchivo
 */
export function exportarLibroExcel(hojas, nombreArchivo) {
  if (!xlsxDisponible()) {
    return {
      ok: false,
      error:
        "El generador de Excel (SheetJS) no cargó. Verifica tu conexión a internet e inténtalo de nuevo.",
    };
  }

  try {
    const libro = window.XLSX.utils.book_new();

    hojas.forEach((hoja) => {
      const datosParaHoja = hoja.filas.length > 0 ? hoja.filas : [{ "Sin datos": "" }];
      const ws = window.XLSX.utils.json_to_sheet(datosParaHoja);

      // Ancho de columna automático aproximado según el contenido
      const claves = Object.keys(datosParaHoja[0] || {});
      ws["!cols"] = claves.map((k) => {
        const maxLen = Math.max(
          k.length,
          ...datosParaHoja.map((fila) => String(fila[k] ?? "").length)
        );
        return { wch: Math.min(Math.max(maxLen + 2, 10), 40) };
      });

      window.XLSX.utils.book_append_sheet(libro, ws, hoja.nombre.substring(0, 31));
    });

    window.XLSX.writeFile(libro, nombreArchivo);
    return { ok: true };
  } catch (err) {
    console.error("Error exportando Excel:", err);
    return { ok: false, error: "No fue posible generar el archivo Excel." };
  }
}

/**
 * Lee un archivo .xlsx/.csv seleccionado por el usuario y devuelve
 * un arreglo de arreglos (filas crudas) de la primera hoja.
 * @param {File} archivo
 */
/**
 * Lee TODAS las hojas de un libro (no solo la primera). Cada hoja se
 * devuelve como arreglo de arreglos (fila 0 = encabezados).
 * @param {File} archivo
 */
export async function leerTodasLasHojas(archivo) {
  if (!xlsxDisponible()) {
    return { ok: false, error: "El lector de Excel (SheetJS) no cargó. Verifica tu conexión." };
  }
  try {
    const buffer = await archivo.arrayBuffer();
    const libro = window.XLSX.read(buffer, { type: "array" });
    const hojas = {};
    libro.SheetNames.forEach((nombre) => {
      hojas[nombre] = window.XLSX.utils.sheet_to_json(libro.Sheets[nombre], { header: 1, defval: "" });
    });
    return { ok: true, hojas, nombresHojas: libro.SheetNames };
  } catch (err) {
    console.error("Error leyendo libro Excel:", err);
    return { ok: false, error: "No fue posible leer el archivo. Verifica que sea un .xlsx válido." };
  }
}

export async function leerArchivoExcel(archivo) {
  if (!xlsxDisponible()) {
    return { ok: false, error: "El lector de Excel (SheetJS) no cargó. Verifica tu conexión." };
  }
  try {
    const buffer = await archivo.arrayBuffer();
    const libro = window.XLSX.read(buffer, { type: "array" });
    const primeraHoja = libro.SheetNames[0];
    const hoja = libro.Sheets[primeraHoja];
    const filas = window.XLSX.utils.sheet_to_json(hoja, { header: 1, defval: "" });
    return { ok: true, filas, nombreHoja: primeraHoja };
  } catch (err) {
    console.error("Error leyendo Excel:", err);
    return { ok: false, error: "No fue posible leer el archivo. Verifica que sea un .xlsx o .csv válido." };
  }
}
