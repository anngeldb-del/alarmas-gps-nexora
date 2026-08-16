/**
 * permissions.js
 * ⚠️ IMPORTANTE: esto SOLO controla qué ve/oculta la interfaz.
 * La seguridad real vive en firestore/firestore.rules — nunca confiar
 * en este archivo como mecanismo de protección de datos (sección 13).
 */
import { ROLES } from "./config.js";

const MATRIZ_PERMISOS = {
  [ROLES.ADMIN]: {
    dashboard: true,
    clientes: "rw",
    ordenes: "rw",
    cotizaciones: "rw",
    inventario: "rw",
    pagos: "rw",
    adeudos: "rw",
    ingresos: "rw",
    reportes: "rw",
    configuracion: "rw",
    backup: "rw",
    importacion: "rw",
    auditoria: "r",
    gastos: "rw",
  },
  [ROLES.EMPLEADO]: {
    dashboard: true,
    clientes: "rw",
    ordenes: "rw",
    cotizaciones: "rw",
    inventario: "r",
    pagos: "rw",
    adeudos: "r",
    ingresos: "r",
    reportes: "r",
    configuracion: false,
    backup: false,
    importacion: false,
    auditoria: false,
    gastos: false,
  },
  [ROLES.TECNICO]: {
    dashboard: true,
    clientes: "r",
    ordenes: "rw", // solo asignadas — filtrado a nivel de query + reglas
    cotizaciones: false,
    inventario: "r",
    pagos: false,
    adeudos: false,
    ingresos: false,
    reportes: false,
    configuracion: false,
    backup: false,
    importacion: false,
    auditoria: false,
  },
};

export function puede(rol, modulo, accion = "r") {
  const permisos = MATRIZ_PERMISOS[rol];
  if (!permisos) return false;
  const valor = permisos[modulo];
  if (valor === true) return true;
  if (valor === false || valor === undefined) return false;
  if (accion === "r") return valor.includes("r");
  if (accion === "w") return valor.includes("w");
  return false;
}

export function modulosVisibles(rol) {
  const permisos = MATRIZ_PERMISOS[rol] || {};
  return Object.keys(permisos).filter((m) => permisos[m] !== false);
}
