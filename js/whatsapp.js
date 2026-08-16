/**
 * whatsapp.js — Genera mensajes editables y abre WhatsApp con el número
 * del cliente. Nunca abre WhatsApp directo sin mostrar antes el mensaje
 * (sección 22): eso lo controla la UI en app.js (modal de confirmación).
 */
import { formatoMoneda } from "./utils.js";

function limpiarTelefono(telefono) {
  let limpio = (telefono || "").replace(/\D/g, "");
  if (limpio.length === 10) limpio = "52" + limpio; // México sin lada país
  return limpio;
}

export function mensajeCotizacion(cotizacion, empresa) {
  return `Hola ${cotizacion.clienteNombre}, te compartimos la cotización ${cotizacion.folio} de ${empresa.nombreComercial} por un total de ${formatoMoneda(cotizacion.total)}. Quedamos atentos a cualquier duda.`;
}

export function mensajeOrdenLista(orden, empresa) {
  return `Hola ${orden.clienteNombre}, tu orden ${orden.folio} en ${empresa.nombreComercial} ya está lista. Total: ${formatoMoneda(orden.total)}, saldo pendiente: ${formatoMoneda(orden.saldo)}. Quedamos atentos.`;
}

export function mensajeSaldoCliente(cliente, empresa) {
  return `Hola ${cliente.nombre}, te contactamos de ${empresa.nombreComercial}. Actualmente tienes un saldo pendiente de ${formatoMoneda(cliente.saldoPendiente || 0)}. Si deseas realizar tu pago o tienes alguna duda, estamos a tus órdenes.`;
}

/**
 * Abre WhatsApp Web/App con el mensaje YA editado por el usuario.
 * @param {string} telefono
 * @param {string} mensaje
 */
export function abrirWhatsApp(telefono, mensaje) {
  const numero = limpiarTelefono(telefono);
  if (!numero) {
    return { ok: false, error: "El cliente no tiene un teléfono/WhatsApp válido registrado." };
  }
  const url = `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`;
  window.open(url, "_blank", "noopener");
  return { ok: true };
}
