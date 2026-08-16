const CACHE_NAME = "alarmas-gps-v1";
const ARCHIVOS_ESENCIALES = [
  "./index.html",
  "./login.html",
  "./manifest.json",
  "./css/themes.css",
  "./css/main.css",
  "./css/responsive.css",
  "./js/app.js",
  "./js/router.js",
  "./js/utils.js",
  "./js/auth.js",
  "./js/permissions.js",
  "./js/config.js",
  "./js/firebase.js",
  "./js/audit.js",
  "./js/folios.js",
  "./js/cache.js",
  "./js/offline.js",
  "./js/pdf.js",
  "./js/whatsapp.js",
  "./js/excel.js",
  "./js/modules/dashboard.js",
  "./js/modules/clientes.js",
  "./js/modules/productos.js",
  "./js/modules/ordenes.js",
  "./js/modules/cotizaciones.js",
  "./js/modules/pagos.js",
  "./js/modules/adeudos.js",
  "./js/modules/ingresos.js",
  "./js/modules/reportes.js",
  "./js/modules/backup.js",
  "./js/modules/auditoria.js",
  "./js/modules/importacion.js",
  "./js/modules/importacionHistorica.js",
  "./js/modules/busqueda.js",
  "./js/modules/gastos.js",
  "./js/modules/configuracion.js",
  "./assets/logos/reset-alarmas-gps.jpg",
  "./assets/logos/nexora.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARCHIVOS_ESENCIALES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((claves) =>
      Promise.all(
        claves.filter((clave) => clave !== CACHE_NAME).map((clave) => caches.delete(clave))
      )
    )
  );
  self.clients.claim();
});

// Estrategia: network-first para todo lo que sea Firestore/Firebase
// (nunca cachear datos de negocio), cache-first para el shell estático.
self.addEventListener("fetch", (event) => {
  const url = event.request.url;
  const esFirebase = url.includes("googleapis.com") || url.includes("firebaseio.com") || url.includes("gstatic.com/firebasejs");

  if (esFirebase) {
    return; // deja pasar directo a la red, sin intervención del SW
  }

  event.respondWith(
    caches.match(event.request).then((respuestaCache) => {
      return (
        respuestaCache ||
        fetch(event.request).catch(() => {
          if (event.request.mode === "navigate") {
            return caches.match("./index.html");
          }
        })
      );
    })
  );
});
