/**
 * offline.js — Indicador visible de conexión (sección 55).
 * Firestore ya queda persistencia offline silenciosa (firebase.js,
 * enableIndexedDbPersistence) — este módulo solo la hace VISIBLE: un
 * pill en la barra lateral que dice si estás en línea, sin conexión, o
 * sincronizando, y un toast cuando la sincronización termina.
 */
import { db, FIREBASE_CONFIGURED } from "./firebase.js";
import { waitForPendingWrites } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

let estadoActual = navigator.onLine ? "en_linea" : "sin_conexion";
const suscriptores = [];

function notificar() {
  suscriptores.forEach((cb) => cb(estadoActual));
}

export function observarConexion(callback) {
  suscriptores.push(callback);
  callback(estadoActual); // estado inicial inmediato
}

async function manejarVolverEnLinea() {
  estadoActual = "sincronizando";
  notificar();
  try {
    if (FIREBASE_CONFIGURED) {
      await waitForPendingWrites(db); // se resuelve cuando el servidor confirmó todo lo pendiente
    }
    estadoActual = "en_linea";
    notificar();
  } catch (err) {
    console.warn("Hubo un problema confirmando la sincronización:", err);
    estadoActual = "error_sincronizacion";
    notificar();
  }
}

window.addEventListener("online", manejarVolverEnLinea);
window.addEventListener("offline", () => {
  estadoActual = "sin_conexion";
  notificar();
});

const ETIQUETAS = {
  en_linea: { texto: "🟢 En línea", color: "var(--exito)" },
  sin_conexion: { texto: "🟠 Sin conexión — tus cambios se guardan y se sincronizan al volver", color: "var(--acento)" },
  sincronizando: { texto: "🔄 Sincronizando...", color: "var(--acento)" },
  error_sincronizacion: { texto: "⚠️ No se pudo confirmar la sincronización — revisa tu conexión", color: "var(--peligro)" },
};

/**
 * Pinta el indicador en un elemento del DOM y lo mantiene actualizado.
 * Llamar una vez al iniciar la app con el id del contenedor.
 */
export function iniciarIndicadorConexion(idContenedor) {
  const contenedor = document.getElementById(idContenedor);
  if (!contenedor) return;

  let ultimoEstadoMostrado = null;
  observarConexion((estado) => {
    const etq = ETIQUETAS[estado] || ETIQUETAS.en_linea;
    contenedor.textContent = etq.texto;
    contenedor.style.color = etq.color;

    // Toast solo en las transiciones relevantes, no en cada render
    if (ultimoEstadoMostrado === "sincronizando" && estado === "en_linea") {
      window.dispatchEvent(new CustomEvent("sincronizacion-completa"));
    }
    ultimoEstadoMostrado = estado;
  });
}
