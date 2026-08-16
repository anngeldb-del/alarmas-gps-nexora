/**
 * modules/configuracion.js
 * Lee/escribe `configuracion/empresa` en Firestore. Esta es la ÚNICA
 * fuente de verdad para nombre, logo, RFC, IVA, etc. — nunca hardcodear
 * estos valores en otros módulos (sección 6).
 */
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db, FIREBASE_CONFIGURED } from "../firebase.js";
import { registrarAuditoria } from "../audit.js";
import { APP_META } from "../config.js";

const DEFAULTS_EMPRESA = {
  nombreComercial: "ALARMAS Y GPS",
  razonSocial: "",
  rfc: "",
  telefono: "",
  whatsapp: "",
  email: "",
  direccion: "",
  sitioWeb: "",
  logoUrl: "assets/logos/reset-alarmas-gps.jpg",
  eslogan: "Alarmas • GPS • Accesorios • Instalación",
  datosBancarios: "",
  condicionesComerciales: "",
  ivaActivo: true,
  ivaPorcentaje: 16,
  moneda: "MXN",
  vigenciaCotizacionDias: 15,
};

let cacheEmpresa = null;

export async function obtenerConfiguracionEmpresa({ forzarRecarga = false } = {}) {
  if (cacheEmpresa && !forzarRecarga) return cacheEmpresa;

  if (!FIREBASE_CONFIGURED) {
    // La app sigue funcionando con valores por defecto mientras se configura Firebase.
    cacheEmpresa = { ...DEFAULTS_EMPRESA };
    return cacheEmpresa;
  }

  try {
    const ref = doc(db, "configuracion", "empresa");
    const snap = await getDoc(ref);
    cacheEmpresa = snap.exists() ? { ...DEFAULTS_EMPRESA, ...snap.data() } : { ...DEFAULTS_EMPRESA };
    return cacheEmpresa;
  } catch (err) {
    console.error("No se pudo leer configuracion/empresa:", err);
    return { ...DEFAULTS_EMPRESA };
  }
}

export async function guardarConfiguracionEmpresa(datos) {
  if (!FIREBASE_CONFIGURED) {
    return { ok: false, error: "Firebase no configurado. No se guardó nada." };
  }
  try {
    const ref = doc(db, "configuracion", "empresa");
    await setDoc(ref, { ...datos, actualizadoEn: serverTimestamp() }, { merge: true });
    cacheEmpresa = null; // invalidar cache
    await registrarAuditoria({
      accion: "actualizar_configuracion_empresa",
      modulo: "configuracion",
      datos: { campos: Object.keys(datos) },
    });
    return { ok: true };
  } catch (err) {
    console.error("Error guardando configuración de empresa:", err);
    return {
      ok: false,
      error: "No fue posible guardar la configuración. Verifica tu conexión e inténtalo de nuevo.",
    };
  }
}

// Identidad NEXORA (desarrollador) — separada de la identidad del negocio.
// Fija por producto, no editable desde la UI del cliente (sección 4).
export function obtenerIdentidadDesarrollador() {
  return {
    nombre: APP_META.desarrolladoPor,
    responsableTecnico: APP_META.responsableTecnico,
    eslogan: APP_META.eslogan_nexora,
    logoUrl: "assets/logos/nexora.png",
  };
}
