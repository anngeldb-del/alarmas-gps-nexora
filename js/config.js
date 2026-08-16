/**
 * config.js
 * ÚNICO lugar donde deben vivir credenciales/config de Firebase.
 * No mezclar lógica de negocio aquí.
 *
 * ⚠️ CONFIGURACIÓN PENDIENTE (obligatoria antes de usar la app):
 * 1. Crea un proyecto en https://console.firebase.google.com
 * 2. Habilita Authentication (Email/Password) y Cloud Firestore.
 * 3. Copia el "firebaseConfig" que te da la consola y pégalo abajo.
 * 4. Sube firestore/firestore.rules a tu proyecto (Firestore > Reglas).
 */

export const FIREBASE_CONFIG = {
  apiKey: "PENDIENTE_apiKey",
  authDomain: "PENDIENTE.firebaseapp.com",
  projectId: "PENDIENTE",
  storageBucket: "PENDIENTE.appspot.com",
  messagingSenderId: "PENDIENTE",
  appId: "PENDIENTE",
};

// Bandera para saber si ya se configuró Firebase realmente.
export const FIREBASE_CONFIGURED = FIREBASE_CONFIG.apiKey !== "PENDIENTE_apiKey";

/**
 * APP_META: identidad del producto. NUNCA hardcodear el nombre del negocio
 * en pantallas/documentos; siempre leer de aquí (fallback) o de
 * Firestore `configuracion/empresa` (fuente real, editable por el dueño).
 */
export const APP_META = {
  nombreProducto: "ALARMAS Y GPS",
  desarrolladoPor: "NEXORA",
  eslogan_nexora: "Aplicaciones que hacen crecer tu negocio",
  responsableTecnico: "Ing. Luis Ángel Díaz Bernal",
  version: "1.0.0-fase1",
};

// Roles soportados por el sistema de permisos (permissions.js)
export const ROLES = {
  ADMIN: "administrador",
  EMPLEADO: "empleado",
  TECNICO: "tecnico",
};
