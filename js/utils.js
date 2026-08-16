/**
 * utils.js — funciones puras reutilizables. Sin dependencias de Firebase.
 */

export function formatoMoneda(valor) {
  const num = Number(valor) || 0;
  return num.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

export function formatoFecha(fecha) {
  const d = fecha instanceof Date ? fecha : fecha?.toDate?.() || new Date(fecha);
  return d.toLocaleDateString("es-MX", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function formatoFechaHora(fecha) {
  const d = fecha instanceof Date ? fecha : fecha?.toDate?.() || new Date(fecha);
  return d.toLocaleString("es-MX");
}

export function validarEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "");
}

export function validarTelefono(telefono) {
  const limpio = (telefono || "").replace(/\D/g, "");
  return limpio.length >= 10;
}

export function debounce(fn, esperaMs = 300) {
  let temporizador;
  return (...args) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => fn(...args), esperaMs);
  };
}

// ---- Cálculos financieros centralizados (sección 62) ----
// Toda la app DEBE usar estas funciones; nunca duplicar fórmulas.

export function calcularSubtotal(conceptos = []) {
  return conceptos.reduce((acc, c) => acc + (Number(c.cantidad) || 0) * (Number(c.precio) || 0), 0);
}

export function calcularConDescuento(subtotal, descuento = 0) {
  const desc = Number(descuento) || 0;
  return Math.max(subtotal - desc, 0);
}

export function calcularIVA(subtotalNeto, porcentajeIVA = 16, ivaActivo = true) {
  if (!ivaActivo) return 0;
  return subtotalNeto * (Number(porcentajeIVA) / 100);
}

export function calcularTotal(subtotalNeto, iva) {
  return subtotalNeto + iva;
}

export function calcularSaldo(total, totalPagado) {
  const saldo = Number(total) - Number(totalPagado);
  return saldo < 0 ? 0 : saldo; // nunca negativo por accidente (sección 35)
}

// ---- Toasts ----
export function mostrarToast(mensaje, tipo = "info") {
  const contenedor = document.getElementById("toast-container");
  if (!contenedor) {
    console.warn("toast-container no encontrado en el DOM:", mensaje);
    return;
  }
  const toast = document.createElement("div");
  toast.className = `toast toast--${tipo}`;
  const iconos = { exito: "✅", error: "⚠️", info: "ℹ️" };
  toast.textContent = `${iconos[tipo] || ""} ${mensaje}`;
  contenedor.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("toast--visible"));
  setTimeout(() => {
    toast.classList.remove("toast--visible");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
