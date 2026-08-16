/**
 * router.js — router basado en hash. Cada vista es una función que
 * recibe el <main id="vista"> y lo llena. Fase 1 solo registra
 * dashboard/clientes/configuracion; los módulos de fases posteriores
 * se agregan aquí con una línea cada uno.
 */
const rutas = {};

export function registrarRuta(nombre, render) {
  rutas[nombre] = render;
}

export function navegar(nombre) {
  window.location.hash = `#/${nombre}`;
}

async function manejarCambioRuta() {
  const hash = window.location.hash.replace("#/", "") || "dashboard";
  const render = rutas[hash] || rutas["dashboard"];
  const contenedor = document.getElementById("vista");
  if (!contenedor) return;

  document
    .querySelectorAll(".nav-link")
    .forEach((el) => el.classList.toggle("nav-link--activo", el.dataset.ruta === hash));

  contenedor.innerHTML = `<div class="skeleton skeleton--vista"></div>`;
  try {
    await render(contenedor);
  } catch (err) {
    console.error(`Error renderizando la vista "${hash}":`, err);
    contenedor.innerHTML = `<div class="estado-error">⚠️ No fue posible cargar esta sección.</div>`;
  }
}

export function iniciarRouter() {
  window.addEventListener("hashchange", manejarCambioRuta);
  manejarCambioRuta();
}
