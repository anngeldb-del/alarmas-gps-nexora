/**
 * app.js — orquesta sesión, permisos, router y vistas de Fase 1.
 */
import { observarSesion, cerrarSesion, obtenerPerfilUsuario } from "./auth.js";
import { puede, modulosVisibles } from "./permissions.js";
import { registrarRuta, navegar, iniciarRouter } from "./router.js";
import { mostrarToast, formatoFecha } from "./utils.js";
import { FIREBASE_CONFIGURED } from "./firebase.js";
import {
  obtenerConfiguracionEmpresa,
  guardarConfiguracionEmpresa,
  obtenerIdentidadDesarrollador,
} from "./modules/configuracion.js";
import { cargarKPIs, renderKPIs } from "./modules/dashboard.js";
import {
  listarClientes,
  listarClientesPaginado,
  crearCliente,
  editarCliente,
  desactivarCliente,
} from "./modules/clientes.js";
import {
  listarProductos,
  crearProducto,
  editarProducto,
  desactivarProducto,
  registrarMovimiento,
  historialMovimientos,
} from "./modules/productos.js";
import {
  listarOrdenes,
  listarOrdenesPaginado,
  crearOrden,
  editarOrden,
  cambiarEstadoOrden,
  ESTADOS_ORDEN,
} from "./modules/ordenes.js";
import {
  listarCotizaciones,
  listarCotizacionesPaginado,
  crearCotizacion,
  editarCotizacion,
  cambiarEstadoCotizacion,
  convertirEnOrden,
  revisarYMarcarVencidas,
} from "./modules/cotizaciones.js";
import { generarPDF, descargarPDF, compartirPDF } from "./pdf.js";
import { mensajeCotizacion, mensajeSaldoCliente, abrirWhatsApp } from "./whatsapp.js";
import { registrarPago, listarPagosDeOrden } from "./modules/pagos.js";
import { listarAdeudos } from "./modules/adeudos.js";
import { listarIngresos, totalIngresos, agruparPorMetodo } from "./modules/ingresos.js";
import { generarReporteMensual, obtenerClientesParaExportar } from "./modules/reportes.js";
import { exportarLibroExcel } from "./excel.js";
import { generarBackupJSON, generarBackupExcel, descargarBlob } from "./modules/backup.js";
import { listarAuditoria } from "./modules/auditoria.js";
import {
  listarGastos,
  crearGasto,
  editarGasto,
  desactivarGasto,
  CATEGORIAS_GASTO,
  totalGastos,
} from "./modules/gastos.js";
import {
  procesarArchivo,
  validarYPrepararImportacion,
  ejecutarImportacionClientes,
  CAMPOS_IMPORTABLES_CLIENTES,
} from "./modules/importacion.js";
import {
  procesarArchivoHistorico,
  prepararPlanImportacion,
  ejecutarImportacionHistorica,
  obtenerIdsYaImportados,
} from "./modules/importacionHistorica.js";
import { buscarGlobal } from "./modules/busqueda.js";
import { iniciarIndicadorConexion } from "./offline.js";
import { conCache, invalidarPrefijo } from "./cache.js";
import { formatoMoneda as fm, formatoFechaHora, debounce } from "./utils.js";

let sesionActual = null; // { user, perfil }

/** Rol del usuario en sesión. Fallback al MÁS restrictivo si por alguna
 * razón el perfil aún no cargó — nunca se asume "administrador" por
 * defecto (principio de mínimo privilegio). En operación normal esto no
 * debería activarse: iniciar() ya espera el perfil real antes de pintar
 * cualquier vista. */
function rolActual() {
  return sesionActual?.perfil?.rol || "tecnico";
}

const NOMBRES_MODULO = {
  dashboard: "Dashboard",
  clientes: "Clientes",
  ordenes: "Órdenes",
  cotizaciones: "Cotizaciones",
  // inventario: "Inventario", // ⏸️ Oculto del menú a petición de Angel — su negocio
  // real (validado con AlarmasReset-2026-07-27.xlsx) no usa SKU/stock, rastrea
  // Costo/Inversión/Ganancia por servicio. El módulo, la ruta y las reglas de
  // Firestore siguen intactos: para reactivarlo solo hay que descomentar esta línea.
  pagos: "Pagos",
  adeudos: "Adeudos",
  ingresos: "Ingresos",
  reportes: "Reportes",
  gastos: "Gastos",
  configuracion: "Configuración",
  backup: "Copias de seguridad",
  importacion: "Importar datos",
  auditoria: "Auditoría",
};

async function iniciar() {
  if (!FIREBASE_CONFIGURED) {
    document.getElementById("banner-config").style.display = "block";
  }
  iniciarIndicadorConexion("indicador-conexion");
  window.addEventListener("sincronizacion-completa", () => {
    mostrarToast("Conexión restaurada — tus cambios ya se sincronizaron.", "exito");
  });

  const empresa = await obtenerConfiguracionEmpresa();
  document.title = empresa.nombreComercial;
  document.querySelectorAll("[data-empresa-nombre]").forEach((el) => (el.textContent = empresa.nombreComercial));
  document.querySelectorAll("[data-empresa-eslogan]").forEach((el) => (el.textContent = empresa.eslogan));

  const nexora = obtenerIdentidadDesarrollador();
  document.querySelectorAll("[data-dev-nombre]").forEach((el) => (el.textContent = `Desarrollado por ${nexora.nombre}`));

  let intervaloRevisionPerfil = null;

  observarSesion(async (user) => {
    if (intervaloRevisionPerfil) {
      clearInterval(intervaloRevisionPerfil);
      intervaloRevisionPerfil = null;
    }
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    const perfil = await obtenerPerfilUsuario(user.uid);
    if (!perfil || perfil.activo === false) {
      // Sesión válida en Firebase Auth pero sin perfil (o desactivado) en
      // Firestore — no debe entrar como si fuera administrador por defecto.
      await cerrarSesion();
      window.location.href = "login.html";
      return;
    }
    sesionActual = { user, perfil };
    renderNav();
    registrarVistas();
    iniciarRouter();
    inicializarBusquedaGlobal();

    // ⚠️ Sin esto, si un administrador DESACTIVA a este usuario o le
    // cambia el rol mientras tiene la app abierta, seguiría operando con
    // los permisos viejos hasta que recargue la página manualmente (no
    // hay backend/Cloud Functions en este proyecto para forzar el cierre
    // de sesión al instante). Esta revisión cada 5 minutos acota ese
    // riesgo a una ventana máxima razonable, sin agregar costo relevante
    // (1 lectura de Firestore cada 5 minutos por sesión activa).
    intervaloRevisionPerfil = setInterval(async () => {
      invalidarPrefijo(`perfil:${user.uid}`); // fuerza a que la caché de 60s no tape el cambio
      const perfilActualizado = await obtenerPerfilUsuario(user.uid);
      if (!perfilActualizado || perfilActualizado.activo === false) {
        mostrarToast("Tu cuenta fue desactivada. Cerrando sesión...", "error");
        clearInterval(intervaloRevisionPerfil);
        await cerrarSesion();
        setTimeout(() => (window.location.href = "login.html"), 1500);
        return;
      }
      if (perfilActualizado.rol !== sesionActual?.perfil?.rol) {
        // El rol cambió en caliente — recargar para que la UI (menú,
        // botones) refleje el nuevo rol de inmediato.
        mostrarToast("Tu rol de acceso cambió. Actualizando la app...", "info");
        setTimeout(() => window.location.reload(), 1500);
      }
    }, 5 * 60 * 1000);
  });

  document.getElementById("btn-cerrar-sesion")?.addEventListener("click", async () => {
    const r = await cerrarSesion();
    if (r.ok) window.location.href = "login.html";
    else mostrarToast(r.error, "error");
  });
}

function renderNav() {
  const rol = rolActual(); // perfil real ya cargado en iniciar() antes de llegar aquí
  const nav = document.getElementById("nav-links");
  if (!nav) return;
  const visibles = modulosVisibles(rol).filter((m) => NOMBRES_MODULO[m]);
  nav.innerHTML = visibles
    .map((m) => `<a href="#/${m}" class="nav-link" data-ruta="${m}">${NOMBRES_MODULO[m]}</a>`)
    .join("");
}

function registrarVistas() {
  registrarRuta("dashboard", vistaDashboard);
  registrarRuta("clientes", vistaClientes);
  registrarRuta("inventario", vistaInventario);
  registrarRuta("ordenes", vistaOrdenes);
  registrarRuta("cotizaciones", vistaCotizaciones);
  registrarRuta("adeudos", vistaAdeudos);
  registrarRuta("ingresos", vistaIngresos);
  registrarRuta("reportes", vistaReportes);
  registrarRuta("gastos", vistaGastos);
  registrarRuta("backup", vistaBackup);
  registrarRuta("auditoria", vistaAuditoria);
  registrarRuta("importacion", vistaImportacion);
  registrarRuta("configuracion", vistaConfiguracion);
}

// ---------------- BÚSQUEDA GLOBAL (sección 47) ----------------
function inicializarBusquedaGlobal() {
  const input = document.getElementById("input-busqueda-global");
  const panel = document.getElementById("resultados-busqueda-global");
  if (!input || !panel) return;

  const ejecutarBusqueda = debounce(async (termino) => {
    if (termino.trim().length < 2) {
      panel.style.display = "none";
      return;
    }
    const r = await buscarGlobal(termino);
    renderResultadosBusqueda(r, panel);
  }, 350);

  input.addEventListener("input", (e) => ejecutarBusqueda(e.target.value));
  document.addEventListener("click", (e) => {
    if (!panel.contains(e.target) && e.target !== input) panel.style.display = "none";
  });
}

function renderResultadosBusqueda(resultados, panel) {
  const grupos = [
    { titulo: "CLIENTES", items: resultados.clientes, render: (c) => `${escapeHtml(c.nombre)} · ${escapeHtml(c.telefono || "")}`, ruta: "clientes" },
    { titulo: "ÓRDENES", items: resultados.ordenes, render: (o) => `${escapeHtml(o.folio)} · ${escapeHtml(o.clienteNombre)}`, ruta: "ordenes" },
    { titulo: "COTIZACIONES", items: resultados.cotizaciones, render: (c) => `${escapeHtml(c.folio)} · ${escapeHtml(c.clienteNombre)}`, ruta: "cotizaciones" },
    { titulo: "PRODUCTOS", items: resultados.productos, render: (p) => `${escapeHtml(p.nombre)} · SKU ${escapeHtml(p.sku)}`, ruta: "inventario" },
  ].filter((g) => g.items.length > 0);

  if (grupos.length === 0) {
    panel.innerHTML = `<p style="color:var(--texto-secundario); font-size:0.85rem; margin:0;">Sin resultados.</p>`;
    panel.style.display = "block";
    return;
  }

  panel.innerHTML = grupos
    .map(
      (g) => `
      <div style="margin-bottom:10px;">
        <div style="font-size:0.7rem; font-weight:700; color:var(--acento); margin-bottom:4px;">${g.titulo}</div>
        ${g.items.map((item) => `<div class="resultado-busqueda" data-ruta="${g.ruta}" style="padding:6px 4px; font-size:0.85rem; cursor:pointer; border-radius:6px;">${g.render(item)}</div>`).join("")}
      </div>`
    )
    .join("");
  panel.style.display = "block";

  panel.querySelectorAll(".resultado-busqueda").forEach((el) => {
    el.addEventListener("mouseenter", () => (el.style.background = "rgba(255,107,0,0.1)"));
    el.addEventListener("mouseleave", () => (el.style.background = "transparent"));
    el.addEventListener("click", () => {
      navegar(el.dataset.ruta);
      panel.style.display = "none";
      document.getElementById("input-busqueda-global").value = "";
    });
  });
}

// ---------------- VISTA: DASHBOARD ----------------
async function vistaDashboard(contenedor) {
  contenedor.innerHTML = `
    <h1 class="vista-titulo">Dashboard</h1>
    <div id="kpi-grid" class="kpi-grid"></div>
  `;
  const kpis = await cargarKPIs();
  renderKPIs(kpis);
}

// ---------------- VISTA: CLIENTES ----------------
let estadoPaginacionClientes = { items: [], cursor: null, hayMas: false };

async function vistaClientes(contenedor) {
  const puedeEscribir = puede(rolActual(), "clientes", "w");
  contenedor.innerHTML = `
    <div class="vista-header">
      <h1 class="vista-titulo">Clientes</h1>
      ${puedeEscribir ? `<button id="btn-nuevo-cliente" class="btn btn--primario">+ Nuevo cliente</button>` : ""}
    </div>
    <div id="tabla-clientes"></div>
    <div id="contenedor-cargar-mas-clientes" style="text-align:center; margin-top:14px;"></div>
  `;
  document.getElementById("btn-nuevo-cliente")?.addEventListener("click", () => abrirFormularioCliente());
  estadoPaginacionClientes = { items: [], cursor: null, hayMas: false };
  await refrescarListaClientes({ reiniciar: true });
}

async function refrescarListaClientes({ reiniciar = false } = {}) {
  const tabla = document.getElementById("tabla-clientes");
  const contenedorBoton = document.getElementById("contenedor-cargar-mas-clientes");
  if (!tabla) return;
  const puedeEscribir = puede(rolActual(), "clientes", "w");

  if (reiniciar) estadoPaginacionClientes = { items: [], cursor: null, hayMas: false };

  const pagina = await listarClientesPaginado({ soloActivos: true, cursor: reiniciar ? null : estadoPaginacionClientes.cursor });
  estadoPaginacionClientes = {
    items: reiniciar ? pagina.items : [...estadoPaginacionClientes.items, ...pagina.items],
    cursor: pagina.cursor,
    hayMas: pagina.hayMas,
  };
  const clientes = estadoPaginacionClientes.items;

  if (clientes.length === 0) {
    tabla.innerHTML = `
      <div class="estado-vacio">
        <p>No existen clientes todavía.</p>
        ${puedeEscribir ? `<button class="btn btn--primario" onclick="document.getElementById('btn-nuevo-cliente')?.click()">+ Crear primer cliente</button>` : ""}
      </div>`;
    if (contenedorBoton) contenedorBoton.innerHTML = "";
    return;
  }

  tabla.innerHTML = `
    <div class="tarjetas-lista">
      ${clientes
        .map(
          (c) => `
        <div class="tarjeta-item">
          <div class="tarjeta-item__principal">
            <strong>${escapeHtml(c.nombre)}</strong>
            <span>${escapeHtml(c.telefono || "Sin teléfono")}</span>
          </div>
          <div class="tarjeta-item__acciones">
            ${puedeEscribir ? `<button class="btn btn--secundario" data-editar="${c.id}">Editar</button>` : ""}
            ${puedeEscribir ? `<button class="btn btn--peligro" data-desactivar="${c.id}">Desactivar</button>` : ""}
          </div>
        </div>`
        )
        .join("")}
    </div>`;

  if (contenedorBoton) {
    contenedorBoton.innerHTML = estadoPaginacionClientes.hayMas
      ? `<button id="btn-cargar-mas-clientes" class="btn btn--secundario">Cargar más</button>`
      : `<span style="color:var(--texto-secundario); font-size:.8rem;">${clientes.length} cliente(s)</span>`;
    document.getElementById("btn-cargar-mas-clientes")?.addEventListener("click", () => refrescarListaClientes({ reiniciar: false }));
  }

  tabla.querySelectorAll("[data-editar]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const cliente = clientes.find((c) => c.id === btn.dataset.editar);
      abrirFormularioCliente(cliente);
    })
  );
  tabla.querySelectorAll("[data-desactivar]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("¿Desactivar este cliente? No se eliminará su historial.")) return;
      const r = await desactivarCliente(btn.dataset.desactivar);
      if (r.ok) {
        mostrarToast("Cliente desactivado.", "exito");
        refrescarListaClientes({ reiniciar: true });
      } else {
        mostrarToast(r.error, "error");
      }
    })
  );
}

function abrirFormularioCliente(cliente = null) {
  const modal = document.getElementById("modal-generico");
  const esEdicion = Boolean(cliente);
  modal.innerHTML = `
    <div class="modal__contenido">
      <h2>${esEdicion ? "Editar cliente" : "Nuevo cliente"}</h2>
      <form id="form-cliente">
        <label>Nombre / razón social *
          <input name="nombre" required value="${cliente ? escapeHtml(cliente.nombre) : ""}">
        </label>
        <label>Teléfono
          <input name="telefono" value="${cliente ? escapeHtml(cliente.telefono || "") : ""}">
        </label>
        <label>Email
          <input name="email" type="email" value="${cliente ? escapeHtml(cliente.email || "") : ""}">
        </label>
        <label>RFC
          <input name="rfc" value="${cliente ? escapeHtml(cliente.rfc || "") : ""}">
        </label>
        <label>Dirección
          <input name="direccion" value="${cliente ? escapeHtml(cliente.direccion || "") : ""}">
        </label>
        <label>Notas
          <textarea name="notas">${cliente ? escapeHtml(cliente.notas || "") : ""}</textarea>
        </label>
        <div class="modal__acciones">
          <button type="button" class="btn btn--secundario" id="btn-cancelar-modal">Cancelar</button>
          <button type="submit" class="btn btn--primario">Guardar</button>
        </div>
      </form>
    </div>`;
  modal.classList.add("modal--visible");

  document.getElementById("btn-cancelar-modal").addEventListener("click", cerrarModal);
  document.getElementById("form-cliente").addEventListener("submit", async (e) => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(e.target).entries());
    const r = esEdicion ? await editarCliente(cliente.id, datos) : await crearCliente(datos);
    if (r.ok) {
      mostrarToast(esEdicion ? "Cliente actualizado." : "Cliente creado correctamente.", "exito");
      cerrarModal();
      refrescarListaClientes({ reiniciar: true });
    } else {
      mostrarToast(r.error, "error");
    }
  });
}

function cerrarModal() {
  document.getElementById("modal-generico").classList.remove("modal--visible");
}

// ---------------- VISTA: INVENTARIO ----------------
async function vistaInventario(contenedor) {
  contenedor.innerHTML = `
    <div class="vista-header">
      <h1 class="vista-titulo">Inventario</h1>
      <button id="btn-nuevo-producto" class="btn btn--primario">+ Nuevo producto</button>
    </div>
    <div id="tabla-productos"></div>
  `;
  document.getElementById("btn-nuevo-producto").addEventListener("click", () => abrirFormularioProducto());
  await refrescarListaProductos();
}

async function refrescarListaProductos() {
  const tabla = document.getElementById("tabla-productos");
  if (!tabla) return;
  const productos = await listarProductos({ soloActivos: true });

  if (productos.length === 0) {
    tabla.innerHTML = `
      <div class="estado-vacio">
        <p>No existen productos todavía.</p>
        <button class="btn btn--primario" onclick="document.getElementById('btn-nuevo-producto').click()">+ Crear primer producto</button>
      </div>`;
    return;
  }

  tabla.innerHTML = `
    <div class="tarjetas-lista">
      ${productos
        .map((p) => {
          const stockBajo = Number(p.stock) <= Number(p.stockMinimo);
          return `
        <div class="tarjeta-item">
          <div class="tarjeta-item__principal">
            <strong>${escapeHtml(p.nombre)} ${stockBajo ? '<span title="Stock bajo">⚠️</span>' : ""}</strong>
            <span>SKU ${escapeHtml(p.sku)} · Stock: ${p.stock} ${escapeHtml(p.unidad)} · ${fm(p.precio)}</span>
          </div>
          <div class="tarjeta-item__acciones">
            <button class="btn btn--secundario" data-movimiento="${p.id}">Entrada/Salida</button>
            <button class="btn btn--secundario" data-editar="${p.id}">Editar</button>
            <button class="btn btn--peligro" data-desactivar="${p.id}">Desactivar</button>
          </div>
        </div>`;
        })
        .join("")}
    </div>`;

  tabla.querySelectorAll("[data-editar]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const producto = productos.find((p) => p.id === btn.dataset.editar);
      abrirFormularioProducto(producto);
    })
  );
  tabla.querySelectorAll("[data-movimiento]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const producto = productos.find((p) => p.id === btn.dataset.movimiento);
      abrirFormularioMovimiento(producto);
    })
  );
  tabla.querySelectorAll("[data-desactivar]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("¿Desactivar este producto?")) return;
      const r = await desactivarProducto(btn.dataset.desactivar);
      if (r.ok) {
        mostrarToast("Producto desactivado.", "exito");
        refrescarListaProductos();
      } else {
        mostrarToast(r.error, "error");
      }
    })
  );
}

function abrirFormularioProducto(producto = null) {
  const modal = document.getElementById("modal-generico");
  const esEdicion = Boolean(producto);
  modal.innerHTML = `
    <div class="modal__contenido">
      <h2>${esEdicion ? "Editar producto" : "Nuevo producto"}</h2>
      <form id="form-producto">
        <label>Nombre *
          <input name="nombre" required value="${producto ? escapeHtml(producto.nombre) : ""}">
        </label>
        <label>SKU / Código *
          <input name="sku" required value="${producto ? escapeHtml(producto.sku) : ""}">
        </label>
        <label>Categoría
          <input name="categoria" value="${producto ? escapeHtml(producto.categoria || "") : ""}">
        </label>
        <label>Marca
          <input name="marca" value="${producto ? escapeHtml(producto.marca || "") : ""}">
        </label>
        <label>Costo
          <input name="costo" type="number" step="0.01" min="0" value="${producto ? producto.costo : "0"}">
        </label>
        <label>Precio de venta *
          <input name="precio" type="number" step="0.01" min="0" required value="${producto ? producto.precio : "0"}">
        </label>
        ${!esEdicion ? `
        <label>Stock inicial
          <input name="stockInicial" type="number" min="0" value="0">
        </label>` : ""}
        <label>Stock mínimo
          <input name="stockMinimo" type="number" min="0" value="${producto ? producto.stockMinimo : "0"}">
        </label>
        <label>Unidad
          <input name="unidad" value="${producto ? escapeHtml(producto.unidad || "pieza") : "pieza"}">
        </label>
        <label>Proveedor
          <input name="proveedor" value="${producto ? escapeHtml(producto.proveedor || "") : ""}">
        </label>
        <label>Ubicación
          <input name="ubicacion" value="${producto ? escapeHtml(producto.ubicacion || "") : ""}">
        </label>
        <div class="modal__acciones">
          <button type="button" class="btn btn--secundario" id="btn-cancelar-modal">Cancelar</button>
          <button type="submit" class="btn btn--primario">Guardar</button>
        </div>
      </form>
    </div>`;
  modal.classList.add("modal--visible");

  document.getElementById("btn-cancelar-modal").addEventListener("click", cerrarModal);
  document.getElementById("form-producto").addEventListener("submit", async (e) => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(e.target).entries());
    const r = esEdicion ? await editarProducto(producto.id, datos) : await crearProducto(datos);
    if (r.ok) {
      mostrarToast(esEdicion ? "Producto actualizado." : "Producto creado correctamente.", "exito");
      cerrarModal();
      refrescarListaProductos();
    } else {
      mostrarToast(r.error, "error");
    }
  });
}

function abrirFormularioMovimiento(producto) {
  const modal = document.getElementById("modal-generico");
  modal.innerHTML = `
    <div class="modal__contenido">
      <h2>Movimiento de inventario</h2>
      <p style="color:var(--texto-secundario); font-size:0.85rem;">${escapeHtml(producto.nombre)} — Stock actual: <strong>${producto.stock}</strong></p>
      <form id="form-movimiento">
        <label>Tipo de movimiento
          <select name="tipo" id="select-tipo-movimiento">
            <option value="entrada">Entrada</option>
            <option value="salida">Salida</option>
            <option value="ajuste">Ajuste (fijar stock exacto)</option>
          </select>
        </label>
        <label>Cantidad *
          <input name="cantidad" id="input-cantidad-movimiento" type="number" min="1" required>
        </label>
        <label>Motivo
          <input name="motivo" placeholder="Ej. compra a proveedor, venta directa...">
        </label>
        <div class="modal__acciones">
          <button type="button" class="btn btn--secundario" id="btn-cancelar-modal">Cancelar</button>
          <button type="submit" class="btn btn--primario">Registrar</button>
        </div>
      </form>
    </div>`;
  modal.classList.add("modal--visible");

  document.getElementById("btn-cancelar-modal").addEventListener("click", cerrarModal);
  document.getElementById("select-tipo-movimiento").addEventListener("change", (e) => {
    const inputCantidad = document.getElementById("input-cantidad-movimiento");
    inputCantidad.min = e.target.value === "ajuste" ? "0" : "1";
  });

  document.getElementById("form-movimiento").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const r = await registrarMovimiento({
      productoId: producto.id,
      tipo: fd.tipo,
      cantidad: fd.cantidad,
      motivo: fd.motivo || fd.tipo,
    });
    if (r.ok) {
      mostrarToast("Movimiento registrado. Nuevo stock: " + r.stockNuevo, "exito");
      cerrarModal();
      refrescarListaProductos();
    } else {
      mostrarToast(r.error, "error");
    }
  });
}

// ---------------- VISTA: ÓRDENES ----------------
const ETIQUETAS_ESTADO = {
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  esperando_piezas: "Esperando piezas",
  terminada: "Terminada",
  entregada: "Entregada",
  cancelada: "Cancelada",
};

let estadoPaginacionOrdenes = { items: [], cursor: null, hayMas: false };

async function vistaOrdenes(contenedor) {
  // Técnico solo debe actualizar el estado de sus órdenes asignadas —
  // no crear órdenes nuevas ni editar el detalle completo (ver README 6.9/6.12).
  const puedeCrearOEditar = rolActual() !== "tecnico";
  contenedor.innerHTML = `
    <div class="vista-header">
      <h1 class="vista-titulo">Órdenes de trabajo</h1>
      ${puedeCrearOEditar ? `<button id="btn-nueva-orden" class="btn btn--primario">+ Nueva orden</button>` : ""}
    </div>
    <div id="tabla-ordenes"></div>
    <div id="contenedor-cargar-mas-ordenes" style="text-align:center; margin-top:14px;"></div>
  `;
  document.getElementById("btn-nueva-orden")?.addEventListener("click", () => abrirFormularioOrden());
  estadoPaginacionOrdenes = { items: [], cursor: null, hayMas: false };
  await refrescarListaOrdenes({ reiniciar: true });
}

async function refrescarListaOrdenes({ reiniciar = false } = {}) {
  const tabla = document.getElementById("tabla-ordenes");
  const contenedorBoton = document.getElementById("contenedor-cargar-mas-ordenes");
  if (!tabla) return;
  const puedeCrearOEditar = rolActual() !== "tecnico";
  const puedeRegistrarPago = puede(rolActual(), "pagos", "w");

  if (reiniciar) estadoPaginacionOrdenes = { items: [], cursor: null, hayMas: false };

  const pagina = await listarOrdenesPaginado({ cursor: reiniciar ? null : estadoPaginacionOrdenes.cursor });
  estadoPaginacionOrdenes = {
    items: reiniciar ? pagina.items : [...estadoPaginacionOrdenes.items, ...pagina.items],
    cursor: pagina.cursor,
    hayMas: pagina.hayMas,
  };
  const ordenes = estadoPaginacionOrdenes.items;

  if (ordenes.length === 0) {
    tabla.innerHTML = `
      <div class="estado-vacio">
        <p>No existen órdenes todavía.</p>
        ${puedeCrearOEditar ? `<button class="btn btn--primario" onclick="document.getElementById('btn-nueva-orden')?.click()">+ Crear primera orden</button>` : ""}
      </div>`;
    if (contenedorBoton) contenedorBoton.innerHTML = "";
    return;
  }

  tabla.innerHTML = `
    <div class="tarjetas-lista">
      ${ordenes
        .map(
          (o) => `
        <div class="tarjeta-item">
          <div class="tarjeta-item__principal">
            <strong>${escapeHtml(o.folio)} — ${escapeHtml(o.clienteNombre)}</strong>
            <span>${ETIQUETAS_ESTADO[o.estado] || o.estado} · Total: ${fm(o.total)} · Saldo: ${fm(o.saldo)}</span>
          </div>
          <div class="tarjeta-item__acciones">
            <select data-cambiar-estado="${o.id}" class="btn btn--secundario">
              <option value="">Cambiar estado…</option>
              ${(TRANSICIONES_DISPONIBLES(o.estado))
                .map((e) => `<option value="${e}">${ETIQUETAS_ESTADO[e]}</option>`)
                .join("")}
            </select>
            ${puedeCrearOEditar ? `<button class="btn btn--secundario" data-editar-orden="${o.id}">Editar</button>` : ""}
            <button class="btn btn--secundario" data-pdf-orden="${o.id}">PDF</button>
            ${o.saldo > 0 && puedeRegistrarPago ? `<button class="btn btn--primario" data-pagar-orden="${o.id}">Registrar pago</button>` : ""}
          </div>
        </div>`
        )
        .join("")}
    </div>`;

  if (contenedorBoton) {
    contenedorBoton.innerHTML = estadoPaginacionOrdenes.hayMas
      ? `<button id="btn-cargar-mas-ordenes" class="btn btn--secundario">Cargar más</button>`
      : `<span style="color:var(--texto-secundario); font-size:.8rem;">${ordenes.length} orden(es)</span>`;
    document.getElementById("btn-cargar-mas-ordenes")?.addEventListener("click", () => refrescarListaOrdenes({ reiniciar: false }));
  }

  tabla.querySelectorAll("[data-cambiar-estado]").forEach((sel) =>
    sel.addEventListener("change", async (e) => {
      const nuevoEstado = e.target.value;
      if (!nuevoEstado) return;
      if (nuevoEstado === "entregada" && !confirm("Al marcar como ENTREGADA se descontará el inventario correspondiente. ¿Continuar?")) {
        e.target.value = "";
        return;
      }
      const r = await cambiarEstadoOrden(sel.dataset.cambiarEstado, nuevoEstado);
      if (r.ok) {
        mostrarToast("Estado actualizado a: " + ETIQUETAS_ESTADO[nuevoEstado], "exito");
        refrescarListaOrdenes({ reiniciar: true });
      } else {
        mostrarToast(r.error, "error");
        e.target.value = "";
      }
    })
  );
  tabla.querySelectorAll("[data-editar-orden]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const orden = ordenes.find((o) => o.id === btn.dataset.editarOrden);
      abrirFormularioOrden(orden);
    })
  );
  tabla.querySelectorAll("[data-pdf-orden]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const orden = ordenes.find((o) => o.id === btn.dataset.pdfOrden);
      btn.disabled = true;
      btn.textContent = "Generando...";
      const r = await generarPDF(orden, "orden");
      btn.disabled = false;
      btn.textContent = "PDF";
      if (r.ok) {
        await compartirPDF(r.blob, r.filename);
        mostrarToast("PDF generado.", "exito");
      } else {
        mostrarToast(r.error, "error");
      }
    })
  );
  tabla.querySelectorAll("[data-pagar-orden]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const orden = ordenes.find((o) => o.id === btn.dataset.pagarOrden);
      abrirFormularioPago(orden, () => refrescarListaOrdenes({ reiniciar: true }));
    })
  );
}

function TRANSICIONES_DISPONIBLES(estadoActual) {
  const mapa = {
    pendiente: ["en_proceso", "cancelada"],
    en_proceso: ["esperando_piezas", "terminada", "cancelada"],
    esperando_piezas: ["en_proceso", "terminada", "cancelada"],
    terminada: ["entregada", "en_proceso"],
    entregada: [],
    cancelada: [],
  };
  return mapa[estadoActual] || [];
}

async function abrirFormularioOrden(orden = null) {
  const esEdicion = Boolean(orden);
  const clientes = await conCache("busqueda:clientes", () => listarClientes({ soloActivos: true, limite: 150 }), 20000);
  const productos = await conCache("busqueda:productos", () => listarProductos({ soloActivos: true, limite: 150 }), 20000);
  const modal = document.getElementById("modal-generico");

  let conceptos = orden ? [...orden.conceptos] : [];

  function renderConceptos() {
    return conceptos
      .map(
        (c, idx) => `
      <div class="tarjeta-item" style="padding:8px 10px;">
        <div class="tarjeta-item__principal">
          <strong>${escapeHtml(c.descripcion)}</strong>
          <span>${c.cantidad} x ${fm(c.precio)} = ${fm(c.cantidad * c.precio)}</span>
        </div>
        <button type="button" class="btn btn--peligro" data-quitar-concepto="${idx}">Quitar</button>
      </div>`
      )
      .join("");
  }

  modal.innerHTML = `
    <div class="modal__contenido" style="max-width:520px;">
      <h2>${esEdicion ? `Editar orden ${escapeHtml(orden.folio)}` : "Nueva orden"}</h2>
      <form id="form-orden">
        <label>Cliente *
          <select name="clienteId" required>
            <option value="">Selecciona un cliente</option>
            ${clientes
              .map(
                (c) =>
                  `<option value="${c.id}" ${orden?.clienteId === c.id ? "selected" : ""}>${escapeHtml(c.nombre)}</option>`
              )
              .join("")}
          </select>
        </label>
        <label>Vehículo/equipo
          <input name="vehiculo" value="${orden ? escapeHtml(orden.vehiculo || "") : ""}">
        </label>
        <label>Placas
          <input name="placas" value="${orden ? escapeHtml(orden.placas || "") : ""}">
        </label>

        <h3 style="margin:16px 0 8px;">Conceptos</h3>
        <div id="lista-conceptos">${renderConceptos()}</div>
        <div style="display:flex; gap:8px; margin:10px 0;">
          <select id="select-producto-concepto" style="flex:2;">
            <option value="">Concepto libre (sin producto)</option>
            ${productos.map((p) => `<option value="${p.id}" data-precio="${p.precio}" data-nombre="${escapeHtml(p.nombre)}">${escapeHtml(p.nombre)} (${fm(p.precio)})</option>`).join("")}
          </select>
        </div>
        <div style="display:flex; gap:8px; margin-bottom:14px;">
          <input id="input-desc-concepto" placeholder="Descripción" style="flex:2; min-height:40px; border-radius:8px; border:1px solid var(--borde); background:var(--fondo); color:var(--texto); padding:0 10px;">
          <input id="input-cant-concepto" type="number" min="1" value="1" style="width:70px; min-height:40px; border-radius:8px; border:1px solid var(--borde); background:var(--fondo); color:var(--texto); padding:0 8px;">
          <input id="input-precio-concepto" type="number" min="0" step="0.01" placeholder="Precio" style="width:90px; min-height:40px; border-radius:8px; border:1px solid var(--borde); background:var(--fondo); color:var(--texto); padding:0 8px;">
          <button type="button" id="btn-agregar-concepto" class="btn btn--secundario">Agregar</button>
        </div>

        <label>Descuento
          <input name="descuento" type="number" min="0" step="0.01" value="${orden ? orden.descuento : "0"}">
        </label>
        ${
          esEdicion
            ? `<div style="font-size:.82rem; color:var(--texto-secundario); margin-bottom:12px; background:var(--fondo); border:1px solid var(--borde); border-radius:8px; padding:10px 12px;">
                Ya pagado: <strong style="color:var(--texto);">${fm(orden.anticipo)}</strong> · Saldo actual: <strong style="color:var(--texto);">${fm(orden.saldo)}</strong><br>
                Para registrar un pago nuevo usa el botón "Registrar pago" en la lista de órdenes, no este formulario.
              </div>`
            : `<label>Anticipo (se registrará como pago real)
                <input name="anticipo" type="number" min="0" step="0.01" value="0">
              </label>`
        }
        <label>Observaciones
          <textarea name="observaciones">${orden ? escapeHtml(orden.observaciones || "") : ""}</textarea>
        </label>

        <div class="modal__acciones">
          <button type="button" class="btn btn--secundario" id="btn-cancelar-modal">Cancelar</button>
          <button type="submit" class="btn btn--primario">Guardar orden</button>
        </div>
      </form>
    </div>`;
  modal.classList.add("modal--visible");

  const selectProducto = document.getElementById("select-producto-concepto");
  selectProducto.addEventListener("change", () => {
    const opt = selectProducto.selectedOptions[0];
    if (opt.value) {
      document.getElementById("input-desc-concepto").value = opt.dataset.nombre;
      document.getElementById("input-precio-concepto").value = opt.dataset.precio;
    }
  });

  document.getElementById("btn-agregar-concepto").addEventListener("click", () => {
    const descripcion = document.getElementById("input-desc-concepto").value.trim();
    const cantidad = Number(document.getElementById("input-cant-concepto").value);
    const precio = Number(document.getElementById("input-precio-concepto").value);
    const productoId = selectProducto.value || null;
    if (!descripcion || !cantidad || precio < 0) {
      mostrarToast("Completa descripción, cantidad y precio del concepto.", "error");
      return;
    }
    conceptos.push({ descripcion, cantidad, precio, productoId });
    document.getElementById("lista-conceptos").innerHTML = renderConceptos();
    document.getElementById("lista-conceptos").querySelectorAll("[data-quitar-concepto]").forEach((btn) =>
      btn.addEventListener("click", () => {
        conceptos.splice(Number(btn.dataset.quitarConcepto), 1);
        document.getElementById("lista-conceptos").innerHTML = renderConceptos();
      })
    );
  });

  document.getElementById("btn-cancelar-modal").addEventListener("click", cerrarModal);
  document.getElementById("form-orden").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const clienteSeleccionado = clientes.find((c) => c.id === fd.clienteId);
    const datos = {
      ...fd,
      clienteNombre: clienteSeleccionado?.nombre || "",
      telefono: clienteSeleccionado?.telefono || "",
      conceptos,
    };
    const r = esEdicion ? await editarOrden(orden.id, datos) : await crearOrden(datos);
    if (r.ok) {
      mostrarToast(esEdicion ? "Orden actualizada." : `Orden ${r.folio} creada correctamente.`, "exito");
      if (r.avisoAnticipo) mostrarToast(r.avisoAnticipo, "error");
      cerrarModal();
      refrescarListaOrdenes({ reiniciar: true });
    } else {
      mostrarToast(r.error, "error");
    }
  });
}


// ---------------- VISTA: COTIZACIONES ----------------
const ETIQUETAS_ESTADO_COT = {
  borrador: "Borrador",
  enviada: "Enviada",
  vista: "Vista",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
  vencida: "Vencida",
  convertida: "Convertida",
};
const TRANSICIONES_COT = {
  borrador: ["enviada", "rechazada"],
  enviada: ["vista", "aceptada", "rechazada", "vencida"],
  vista: ["aceptada", "rechazada", "vencida"],
  aceptada: [],
  rechazada: [],
  vencida: [],
  convertida: [],
};

let estadoPaginacionCotizaciones = { items: [], cursor: null, hayMas: false };

async function vistaCotizaciones(contenedor) {
  contenedor.innerHTML = `
    <div class="vista-header">
      <h1 class="vista-titulo">Cotizaciones</h1>
      <button id="btn-nueva-cotizacion" class="btn btn--primario">+ Nueva cotización</button>
    </div>
    <div id="tabla-cotizaciones"></div>
    <div id="contenedor-cargar-mas-cotizaciones" style="text-align:center; margin-top:14px;"></div>
  `;
  document.getElementById("btn-nueva-cotizacion").addEventListener("click", () => abrirFormularioCotizacion());
  const revision = await revisarYMarcarVencidas();
  if (revision.marcadas > 0) {
    mostrarToast(`${revision.marcadas} cotización(es) marcada(s) como vencida(s) automáticamente.`, "info");
  }
  estadoPaginacionCotizaciones = { items: [], cursor: null, hayMas: false };
  await refrescarListaCotizaciones({ reiniciar: true });
}

async function refrescarListaCotizaciones({ reiniciar = false } = {}) {
  const tabla = document.getElementById("tabla-cotizaciones");
  const contenedorBoton = document.getElementById("contenedor-cargar-mas-cotizaciones");
  if (!tabla) return;

  if (reiniciar) estadoPaginacionCotizaciones = { items: [], cursor: null, hayMas: false };

  const pagina = await listarCotizacionesPaginado({ cursor: reiniciar ? null : estadoPaginacionCotizaciones.cursor });
  estadoPaginacionCotizaciones = {
    items: reiniciar ? pagina.items : [...estadoPaginacionCotizaciones.items, ...pagina.items],
    cursor: pagina.cursor,
    hayMas: pagina.hayMas,
  };
  const cotizaciones = estadoPaginacionCotizaciones.items;

  if (cotizaciones.length === 0) {
    tabla.innerHTML = `
      <div class="estado-vacio">
        <p>No existen cotizaciones todavía.</p>
        <button class="btn btn--primario" onclick="document.getElementById('btn-nueva-cotizacion').click()">+ Crear primera cotización</button>
      </div>`;
    if (contenedorBoton) contenedorBoton.innerHTML = "";
    return;
  }

  tabla.innerHTML = `
    <div class="tarjetas-lista">
      ${cotizaciones
        .map(
          (c) => `
        <div class="tarjeta-item" style="flex-direction:column; align-items:stretch;">
          <div class="tarjeta-item__principal">
            <strong>${escapeHtml(c.folio)} — ${escapeHtml(c.clienteNombre)}</strong>
            <span>${ETIQUETAS_ESTADO_COT[c.estado] || c.estado} · Total: ${fm(c.total)}</span>
          </div>
          <div class="tarjeta-item__acciones" style="flex-wrap:wrap; margin-top:8px;">
            <select data-cambiar-estado-cot="${c.id}" class="btn btn--secundario">
              <option value="">Cambiar estado…</option>
              ${(TRANSICIONES_COT[c.estado] || [])
                .map((e) => `<option value="${e}">${ETIQUETAS_ESTADO_COT[e]}</option>`)
                .join("")}
            </select>
            ${!["convertida"].includes(c.estado) ? `<button class="btn btn--secundario" data-editar-cot="${c.id}">Editar</button>` : ""}
            <button class="btn btn--secundario" data-pdf-cot="${c.id}">PDF</button>
            <button class="btn btn--secundario" data-whatsapp-cot="${c.id}">WhatsApp</button>
            ${c.estado === "aceptada" ? `<button class="btn btn--primario" data-convertir-cot="${c.id}">Convertir en orden</button>` : ""}
            ${c.estado === "convertida" ? `<span style="font-size:0.78rem; color:var(--texto-secundario);">→ Orden ${escapeHtml(c.ordenGeneradaFolio || "")}</span>` : ""}
          </div>
        </div>`
        )
        .join("")}
    </div>`;

  if (contenedorBoton) {
    contenedorBoton.innerHTML = estadoPaginacionCotizaciones.hayMas
      ? `<button id="btn-cargar-mas-cotizaciones" class="btn btn--secundario">Cargar más</button>`
      : `<span style="color:var(--texto-secundario); font-size:.8rem;">${cotizaciones.length} cotización(es)</span>`;
    document.getElementById("btn-cargar-mas-cotizaciones")?.addEventListener("click", () => refrescarListaCotizaciones({ reiniciar: false }));
  }

  tabla.querySelectorAll("[data-cambiar-estado-cot]").forEach((sel) =>
    sel.addEventListener("change", async (e) => {
      const nuevoEstado = e.target.value;
      if (!nuevoEstado) return;
      const r = await cambiarEstadoCotizacion(sel.dataset.cambiarEstadoCot, nuevoEstado);
      if (r.ok) {
        mostrarToast("Estado actualizado a: " + ETIQUETAS_ESTADO_COT[nuevoEstado], "exito");
        refrescarListaCotizaciones({ reiniciar: true });
      } else {
        mostrarToast(r.error, "error");
        e.target.value = "";
      }
    })
  );
  tabla.querySelectorAll("[data-editar-cot]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const cot = cotizaciones.find((c) => c.id === btn.dataset.editarCot);
      abrirFormularioCotizacion(cot);
    })
  );
  tabla.querySelectorAll("[data-pdf-cot]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const cot = cotizaciones.find((c) => c.id === btn.dataset.pdfCot);
      btn.disabled = true;
      btn.textContent = "Generando...";
      const r = await generarPDF(cot, "cotizacion");
      btn.disabled = false;
      btn.textContent = "PDF";
      if (r.ok) {
        await compartirPDF(r.blob, r.filename);
        mostrarToast("PDF generado.", "exito");
      } else {
        mostrarToast(r.error, "error");
      }
    })
  );
  tabla.querySelectorAll("[data-whatsapp-cot]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const cot = cotizaciones.find((c) => c.id === btn.dataset.whatsappCot);
      const empresa = await obtenerConfiguracionEmpresa();
      abrirModalMensajeWhatsApp(mensajeCotizacion(cot, empresa), cot.telefono);
    })
  );
  tabla.querySelectorAll("[data-convertir-cot]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("¿Convertir esta cotización en una orden de trabajo? Se copiarán cliente, conceptos y observaciones automáticamente.")) return;
      btn.disabled = true;
      const r = await convertirEnOrden(btn.dataset.convertirCot);
      btn.disabled = false;
      if (r.ok) {
        mostrarToast(`Orden ${r.ordenFolio} creada a partir de la cotización.`, "exito");
        refrescarListaCotizaciones({ reiniciar: true });
      } else {
        mostrarToast(r.error, "error");
      }
    })
  );
}

function abrirModalMensajeWhatsApp(mensajeInicial, telefono) {
  const modal = document.getElementById("modal-generico");
  modal.innerHTML = `
    <div class="modal__contenido">
      <h2>Mensaje de WhatsApp</h2>
      <p style="font-size:0.8rem; color:var(--texto-secundario);">Puedes editar el mensaje antes de enviarlo.</p>
      <form id="form-whatsapp">
        <label>Mensaje
          <textarea name="mensaje" rows="6">${escapeHtml(mensajeInicial)}</textarea>
        </label>
        <div class="modal__acciones">
          <button type="button" class="btn btn--secundario" id="btn-cancelar-modal">Cancelar</button>
          <button type="submit" class="btn btn--primario">Confirmar y abrir WhatsApp</button>
        </div>
      </form>
    </div>`;
  modal.classList.add("modal--visible");
  document.getElementById("btn-cancelar-modal").addEventListener("click", cerrarModal);
  document.getElementById("form-whatsapp").addEventListener("submit", (e) => {
    e.preventDefault();
    const mensaje = new FormData(e.target).get("mensaje");
    const r = abrirWhatsApp(telefono, mensaje);
    if (r.ok) cerrarModal();
    else mostrarToast(r.error, "error");
  });
}

async function abrirFormularioCotizacion(cotizacion = null) {
  const esEdicion = Boolean(cotizacion);
  const clientes = await conCache("busqueda:clientes", () => listarClientes({ soloActivos: true, limite: 150 }), 20000);
  const productos = await conCache("busqueda:productos", () => listarProductos({ soloActivos: true, limite: 150 }), 20000);
  const modal = document.getElementById("modal-generico");

  let conceptos = cotizacion ? [...cotizacion.conceptos] : [];

  function renderConceptos() {
    return conceptos
      .map(
        (c, idx) => `
      <div class="tarjeta-item" style="padding:8px 10px;">
        <div class="tarjeta-item__principal">
          <strong>${escapeHtml(c.descripcion)}</strong>
          <span>${c.cantidad} x ${fm(c.precio)} = ${fm(c.cantidad * c.precio)}</span>
        </div>
        <button type="button" class="btn btn--peligro" data-quitar-concepto-cot="${idx}">Quitar</button>
      </div>`
      )
      .join("");
  }

  modal.innerHTML = `
    <div class="modal__contenido" style="max-width:520px;">
      <h2>${esEdicion ? `Editar cotización ${escapeHtml(cotizacion.folio)}` : "Nueva cotización"}</h2>
      <form id="form-cotizacion">
        <label>Cliente *
          <select name="clienteId" required>
            <option value="">Selecciona un cliente</option>
            ${clientes
              .map(
                (c) =>
                  `<option value="${c.id}" ${cotizacion?.clienteId === c.id ? "selected" : ""}>${escapeHtml(c.nombre)}</option>`
              )
              .join("")}
          </select>
        </label>

        <h3 style="margin:16px 0 8px;">Conceptos</h3>
        <div id="lista-conceptos-cot">${renderConceptos()}</div>
        <div style="display:flex; gap:8px; margin:10px 0;">
          <select id="select-producto-concepto-cot" style="flex:2;">
            <option value="">Concepto libre (sin producto)</option>
            ${productos.map((p) => `<option value="${p.id}" data-precio="${p.precio}" data-nombre="${escapeHtml(p.nombre)}">${escapeHtml(p.nombre)} (${fm(p.precio)})</option>`).join("")}
          </select>
        </div>
        <div style="display:flex; gap:8px; margin-bottom:14px;">
          <input id="input-desc-concepto-cot" placeholder="Descripción" style="flex:2; min-height:40px; border-radius:8px; border:1px solid var(--borde); background:var(--fondo); color:var(--texto); padding:0 10px;">
          <input id="input-cant-concepto-cot" type="number" min="1" value="1" style="width:70px; min-height:40px; border-radius:8px; border:1px solid var(--borde); background:var(--fondo); color:var(--texto); padding:0 8px;">
          <input id="input-precio-concepto-cot" type="number" min="0" step="0.01" placeholder="Precio" style="width:90px; min-height:40px; border-radius:8px; border:1px solid var(--borde); background:var(--fondo); color:var(--texto); padding:0 8px;">
          <button type="button" id="btn-agregar-concepto-cot" class="btn btn--secundario">Agregar</button>
        </div>

        <label>Descuento
          <input name="descuento" type="number" min="0" step="0.01" value="${cotizacion ? cotizacion.descuento : "0"}">
        </label>
        <label>Condiciones
          <textarea name="condiciones">${cotizacion ? escapeHtml(cotizacion.condiciones || "") : ""}</textarea>
        </label>
        <label>Observaciones
          <textarea name="observaciones">${cotizacion ? escapeHtml(cotizacion.observaciones || "") : ""}</textarea>
        </label>

        <div class="modal__acciones">
          <button type="button" class="btn btn--secundario" id="btn-cancelar-modal">Cancelar</button>
          <button type="submit" class="btn btn--primario">Guardar cotización</button>
        </div>
      </form>
    </div>`;
  modal.classList.add("modal--visible");

  const selectProducto = document.getElementById("select-producto-concepto-cot");
  selectProducto.addEventListener("change", () => {
    const opt = selectProducto.selectedOptions[0];
    if (opt.value) {
      document.getElementById("input-desc-concepto-cot").value = opt.dataset.nombre;
      document.getElementById("input-precio-concepto-cot").value = opt.dataset.precio;
    }
  });

  document.getElementById("btn-agregar-concepto-cot").addEventListener("click", () => {
    const descripcion = document.getElementById("input-desc-concepto-cot").value.trim();
    const cantidad = Number(document.getElementById("input-cant-concepto-cot").value);
    const precio = Number(document.getElementById("input-precio-concepto-cot").value);
    const productoId = selectProducto.value || null;
    if (!descripcion || !cantidad || precio < 0) {
      mostrarToast("Completa descripción, cantidad y precio del concepto.", "error");
      return;
    }
    conceptos.push({ descripcion, cantidad, precio, productoId });
    document.getElementById("lista-conceptos-cot").innerHTML = renderConceptos();
    document.getElementById("lista-conceptos-cot").querySelectorAll("[data-quitar-concepto-cot]").forEach((btn) =>
      btn.addEventListener("click", () => {
        conceptos.splice(Number(btn.dataset.quitarConceptoCot), 1);
        document.getElementById("lista-conceptos-cot").innerHTML = renderConceptos();
      })
    );
  });

  document.getElementById("btn-cancelar-modal").addEventListener("click", cerrarModal);
  document.getElementById("form-cotizacion").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const clienteSeleccionado = clientes.find((c) => c.id === fd.clienteId);
    const datos = {
      ...fd,
      clienteNombre: clienteSeleccionado?.nombre || "",
      telefono: clienteSeleccionado?.telefono || "",
      conceptos,
    };
    const r = esEdicion ? await editarCotizacion(cotizacion.id, datos) : await crearCotizacion(datos);
    if (r.ok) {
      mostrarToast(esEdicion ? "Cotización actualizada." : `Cotización ${r.folio} creada correctamente.`, "exito");
      cerrarModal();
      refrescarListaCotizaciones({ reiniciar: true });
    } else {
      mostrarToast(r.error, "error");
    }
  });
}


// ---------------- PAGOS (formulario reutilizable) ----------------
function abrirFormularioPago(orden, alGuardarCallback) {
  const modal = document.getElementById("modal-generico");
  modal.innerHTML = `
    <div class="modal__contenido">
      <h2>Registrar pago — ${escapeHtml(orden.folio)}</h2>
      <p style="font-size:0.85rem; color:var(--texto-secundario);">Saldo pendiente: <strong>${fm(orden.saldo)}</strong></p>
      <form id="form-pago">
        <label>Importe *
          <input name="importe" type="number" min="0.01" step="0.01" required>
        </label>
        <label>Método *
          <select name="metodo" required>
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="deposito">Depósito</option>
            <option value="otro">Otro</option>
          </select>
        </label>
        <label>Observaciones
          <input name="observaciones">
        </label>
        <div class="modal__acciones">
          <button type="button" class="btn btn--secundario" id="btn-cancelar-modal">Cancelar</button>
          <button type="submit" class="btn btn--primario">Registrar</button>
        </div>
      </form>
    </div>`;
  modal.classList.add("modal--visible");
  document.getElementById("btn-cancelar-modal").addEventListener("click", cerrarModal);

  document.getElementById("form-pago").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const datos = { ordenId: orden.id, importe: fd.importe, metodo: fd.metodo, observaciones: fd.observaciones };

    let r = await registrarPago(datos);
    if (!r.ok && r.requiereConfirmacion) {
      const confirmar = confirm(
        `El importe (${fm(fd.importe)}) supera el saldo pendiente (${fm(orden.saldo)}). ¿Registrar de todas formas? Esto requiere autorización administrativa.`
      );
      if (!confirmar) return;
      r = await registrarPago(datos, { forzar: true });
    }

    if (r.ok) {
      mostrarToast(`Pago registrado. Nuevo saldo: ${fm(r.saldoNuevo)}`, "exito");
      cerrarModal();
      if (alGuardarCallback) alGuardarCallback();
    } else {
      mostrarToast(r.error, "error");
    }
  });
}

// ---------------- VISTA: ADEUDOS ----------------
async function vistaAdeudos(contenedor) {
  contenedor.innerHTML = `
    <div class="vista-header">
      <h1 class="vista-titulo">Adeudos</h1>
      <select id="filtro-adeudos" class="btn btn--secundario">
        <option value="todos">Todos</option>
        <option value="vencidos">Vencidos (+30 días)</option>
        <option value="parciales">Con pago parcial</option>
        <option value="sin_pago">Sin pago</option>
      </select>
    </div>
    <div id="tabla-adeudos"></div>
  `;
  document.getElementById("filtro-adeudos").addEventListener("change", (e) => refrescarAdeudos(e.target.value));
  await refrescarAdeudos("todos");
}

async function refrescarAdeudos(filtro) {
  const tabla = document.getElementById("tabla-adeudos");
  if (!tabla) return;
  const filas = await listarAdeudos(filtro);

  if (filas.length === 0) {
    tabla.innerHTML = `<div class="estado-vacio"><p>No hay adeudos con este filtro. 🎉</p></div>`;
    return;
  }

  tabla.innerHTML = `
    <div class="tarjetas-lista">
      ${filas
        .map(
          (f) => `
        <div class="tarjeta-item">
          <div class="tarjeta-item__principal">
            <strong>${escapeHtml(f.clienteNombre)} — ${escapeHtml(f.folio)}</strong>
            <span>Total: ${fm(f.total)} · Pagado: ${fm(f.pagado)} · Saldo: ${fm(f.saldo)} · ${f.diasAtraso} días</span>
          </div>
          <div class="tarjeta-item__acciones">
            <button class="btn btn--secundario" data-recordatorio="${f.clienteId}" data-telefono="${escapeHtml(f.telefono || "")}" data-saldo="${f.saldo}" data-nombre="${escapeHtml(f.clienteNombre)}">WhatsApp</button>
          </div>
        </div>`
        )
        .join("")}
    </div>`;

  tabla.querySelectorAll("[data-recordatorio]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const empresa = await obtenerConfiguracionEmpresa();
      const cliente = { nombre: btn.dataset.nombre, saldoPendiente: Number(btn.dataset.saldo) };
      abrirModalMensajeWhatsApp(mensajeSaldoCliente(cliente, empresa), btn.dataset.telefono);
    })
  );
}

// ---------------- VISTA: INGRESOS ----------------
async function vistaIngresos(contenedor) {
  contenedor.innerHTML = `
    <div class="vista-header">
      <h1 class="vista-titulo">Ingresos</h1>
      <select id="filtro-ingresos" class="btn btn--secundario">
        <option value="hoy">Hoy</option>
        <option value="semana">Esta semana</option>
        <option value="mes" selected>Este mes</option>
        <option value="mes_anterior">Mes anterior</option>
        <option value="anio">Este año</option>
      </select>
    </div>
    <div id="resumen-ingresos"></div>
    <div id="tabla-ingresos" style="margin-top:16px;"></div>
  `;
  document.getElementById("filtro-ingresos").addEventListener("change", (e) => refrescarIngresos(e.target.value));
  await refrescarIngresos("mes");
}

async function refrescarIngresos(periodo) {
  const resumen = document.getElementById("resumen-ingresos");
  const tabla = document.getElementById("tabla-ingresos");
  const pagos = await listarIngresos(periodo);
  const total = totalIngresos(pagos);
  const porMetodo = agruparPorMetodo(pagos);

  resumen.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card"><span class="kpi-card__valor">${fm(total)}</span><span class="kpi-card__label">Total del periodo</span></div>
      ${Object.entries(porMetodo)
        .map(([metodo, monto]) => `<div class="kpi-card"><span class="kpi-card__valor">${fm(monto)}</span><span class="kpi-card__label">${metodo}</span></div>`)
        .join("")}
    </div>`;

  if (pagos.length === 0) {
    tabla.innerHTML = `<div class="estado-vacio"><p>No hay pagos registrados en este periodo.</p></div>`;
    return;
  }

  tabla.innerHTML = `
    <div class="tarjetas-lista">
      ${pagos
        .map(
          (p) => `
        <div class="tarjeta-item">
          <div class="tarjeta-item__principal">
            <strong>${escapeHtml(p.clienteNombre)} — ${escapeHtml(p.ordenFolio)}</strong>
            <span>${formatoFecha(p.fecha)} · ${escapeHtml(p.metodo)}</span>
          </div>
          <strong>${fm(p.importe)}</strong>
        </div>`
        )
        .join("")}
    </div>`;
}


// ---------------- VISTA: REPORTES ----------------
async function vistaReportes(contenedor) {
  const hoy = new Date();
  contenedor.innerHTML = `
    <div class="vista-header">
      <h1 class="vista-titulo">Reporte mensual</h1>
      <div style="display:flex; gap:8px;">
        <select id="select-mes"></select>
        <select id="select-anio"></select>
        <button id="btn-generar-reporte" class="btn btn--primario">Generar</button>
        <button id="btn-exportar-excel" class="btn btn--secundario">Exportar Excel</button>
      </div>
    </div>
    <div id="contenido-reporte"></div>
  `;

  const meses = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const selectMes = document.getElementById("select-mes");
  selectMes.innerHTML = meses.map((m, i) => `<option value="${i + 1}" ${i + 1 === hoy.getMonth() + 1 ? "selected" : ""}>${m}</option>`).join("");
  const selectAnio = document.getElementById("select-anio");
  selectAnio.innerHTML = [hoy.getFullYear(), hoy.getFullYear() - 1].map((a) => `<option value="${a}">${a}</option>`).join("");

  let ultimoReporte = null;

  async function generar() {
    const mes = Number(selectMes.value);
    const anio = Number(selectAnio.value);
    document.getElementById("contenido-reporte").innerHTML = `<div class="skeleton skeleton--vista"></div>`;
    const r = await generarReporteMensual(anio, mes);
    if (!r.ok) {
      mostrarToast(r.error, "error");
      return;
    }
    ultimoReporte = r;
    renderReporte(r, meses);
  }

  document.getElementById("btn-generar-reporte").addEventListener("click", generar);
  document.getElementById("btn-exportar-excel").addEventListener("click", () => {
    if (!ultimoReporte) {
      mostrarToast("Genera el reporte primero.", "error");
      return;
    }
    exportarReporteExcel(ultimoReporte);
  });

  await generar();
}

function renderReporte(r, meses) {
  const contenedor = document.getElementById("contenido-reporte");
  contenedor.innerHTML = `
    <h2 style="margin-top:20px;">${meses[r.mes - 1]} ${r.anio}</h2>
    <div class="kpi-grid">
      <div class="kpi-card"><span class="kpi-card__valor">${fm(r.ingresos)}</span><span class="kpi-card__label">Ingresos</span></div>
      <div class="kpi-card"><span class="kpi-card__valor">${fm(r.ventas)}</span><span class="kpi-card__label">Ventas (órdenes)</span></div>
      <div class="kpi-card"><span class="kpi-card__valor">${r.ordenesCreadas}</span><span class="kpi-card__label">Órdenes creadas</span></div>
      <div class="kpi-card"><span class="kpi-card__valor">${r.ordenesEntregadas}</span><span class="kpi-card__label">Órdenes entregadas</span></div>
      <div class="kpi-card"><span class="kpi-card__valor">${r.cotizacionesCreadas}</span><span class="kpi-card__label">Cotizaciones creadas</span></div>
      <div class="kpi-card"><span class="kpi-card__valor">${r.cotizacionesAceptadas}</span><span class="kpi-card__label">Cotizaciones aceptadas</span></div>
      <div class="kpi-card"><span class="kpi-card__valor">${r.clientesNuevos}</span><span class="kpi-card__label">Clientes nuevos</span></div>
      <div class="kpi-card"><span class="kpi-card__valor">${r.pagosPendientesCantidad}</span><span class="kpi-card__label">Órdenes con saldo</span></div>
      <div class="kpi-card"><span class="kpi-card__valor">${fm(r.adeudos)}</span><span class="kpi-card__label">Adeudos totales</span></div>
      <div class="kpi-card"><span class="kpi-card__valor">${fm(r.gastos)}</span><span class="kpi-card__label">Gastos (módulo pendiente)</span></div>
      <div class="kpi-card"><span class="kpi-card__valor">${fm(r.utilidadEstimada)}</span><span class="kpi-card__label">Utilidad estimada</span></div>
    </div>
    <h3 style="margin-top:20px;">Productos más utilizados</h3>
    ${
      r.productosMasUsados.length === 0
        ? '<p style="color:var(--texto-secundario);">Sin movimientos de inventario este mes.</p>'
        : `<div class="tarjetas-lista">${r.productosMasUsados
            .map((p) => `<div class="tarjeta-item"><span>${escapeHtml(p.nombre)}</span><strong>${p.cantidad}</strong></div>`)
            .join("")}</div>`
    }
  `;
}

async function exportarReporteExcel(r) {
  const clientesParaExportar = await obtenerClientesParaExportar();
  const hojas = [
    {
      nombre: "RESUMEN",
      filas: [
        { Concepto: "Ingresos", Valor: r.ingresos },
        { Concepto: "Ventas", Valor: r.ventas },
        { Concepto: "Órdenes creadas", Valor: r.ordenesCreadas },
        { Concepto: "Órdenes entregadas", Valor: r.ordenesEntregadas },
        { Concepto: "Cotizaciones creadas", Valor: r.cotizacionesCreadas },
        { Concepto: "Cotizaciones aceptadas", Valor: r.cotizacionesAceptadas },
        { Concepto: "Clientes nuevos", Valor: r.clientesNuevos },
        { Concepto: "Adeudos totales", Valor: r.adeudos },
        { Concepto: "Utilidad estimada", Valor: r.utilidadEstimada },
      ],
    },
    { nombre: "VENTAS", filas: r._raw.ordenesDelMes.map((o) => ({ Folio: o.folio, Cliente: o.clienteNombre, Total: o.total, Estado: o.estado })) },
    { nombre: "ORDENES", filas: r._raw.ordenesDelMes.map((o) => ({ Folio: o.folio, Cliente: o.clienteNombre, Estado: o.estado, Saldo: o.saldo })) },
    { nombre: "PAGOS", filas: r._raw.pagosDelMes.map((p) => ({ Folio: p.ordenFolio, Cliente: p.clienteNombre, Importe: p.importe, Metodo: p.metodo })) },
    { nombre: "CLIENTES", filas: clientesParaExportar.map((c) => ({ Nombre: c.nombre, Telefono: c.telefono, Email: c.email })) },
    { nombre: "INVENTARIO", filas: r._raw.productos.map((p) => ({ SKU: p.sku, Nombre: p.nombre, Stock: p.stock, Precio: p.precio })) },
    { nombre: "MOVIMIENTOS INVENTARIO", filas: r._raw.movimientosDelMes.map((m) => ({ Producto: m.productoId, Tipo: m.tipo, Cantidad: m.cantidad })) },
    { nombre: "COTIZACIONES", filas: r._raw.cotizacionesDelMes.map((c) => ({ Folio: c.folio, Cliente: c.clienteNombre, Total: c.total, Estado: c.estado })) },
    { nombre: "GASTOS", filas: r._raw.gastosDelMes.map((g) => ({ Concepto: g.concepto, Categoria: g.categoria, Importe: g.importe, Metodo: g.metodo })) },
  ];
  const res = exportarLibroExcel(hojas, `reporte-${r.anio}-${String(r.mes).padStart(2, "0")}.xlsx`);
  if (res.ok) mostrarToast("Reporte exportado a Excel.", "exito");
  else mostrarToast(res.error, "error");
}

// ---------------- VISTA: BACKUP ----------------
async function vistaBackup(contenedor) {
  contenedor.innerHTML = `
    <h1 class="vista-titulo">Copias de seguridad</h1>
    <p style="color:var(--texto-secundario); max-width:500px;">Descarga un respaldo completo de clientes, productos, órdenes, cotizaciones, pagos, movimientos de inventario y configuración.</p>
    <div style="display:flex; gap:10px; margin-top:16px; flex-wrap:wrap;">
      <button id="btn-backup-json" class="btn btn--primario">Backup JSON</button>
      <button id="btn-backup-excel" class="btn btn--secundario">Backup Excel</button>
    </div>
  `;
  document.getElementById("btn-backup-json").addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Generando...";
    const r = await generarBackupJSON();
    e.target.disabled = false;
    e.target.textContent = "Backup JSON";
    if (r.ok) {
      descargarBlob(r.blob, r.filename);
      mostrarToast("Backup JSON generado.", "exito");
    } else {
      mostrarToast(r.error, "error");
    }
  });
  document.getElementById("btn-backup-excel").addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Generando...";
    const r = await generarBackupExcel();
    e.target.disabled = false;
    e.target.textContent = "Backup Excel";
    if (r.ok) mostrarToast("Backup Excel generado.", "exito");
    else mostrarToast(r.error, "error");
  });
}

// ---------------- VISTA: AUDITORÍA ----------------
async function vistaAuditoria(contenedor) {
  contenedor.innerHTML = `<h1 class="vista-titulo">Auditoría</h1><div id="lista-auditoria"></div>`;
  const registros = await listarAuditoria();
  const lista = document.getElementById("lista-auditoria");

  if (registros.length === 0) {
    lista.innerHTML = `<div class="estado-vacio"><p>Sin registros de auditoría todavía.</p></div>`;
    return;
  }

  lista.innerHTML = `
    <div class="tarjetas-lista">
      ${registros
        .map(
          (r) => `
        <div class="tarjeta-item">
          <div class="tarjeta-item__principal">
            <strong>${escapeHtml(r.accion)} ${r.folio ? "— " + escapeHtml(r.folio) : ""}</strong>
            <span>${escapeHtml(r.usuarioEmail || "sistema")} · ${r.fecha ? formatoFechaHora(r.fecha) : ""}</span>
          </div>
        </div>`
        )
        .join("")}
    </div>`;
}

// ---------------- VISTA: IMPORTACIÓN ----------------
async function vistaImportacion(contenedor) {
  contenedor.innerHTML = `
    <h1 class="vista-titulo">Importar datos</h1>

    <div style="background:var(--fondo-tarjeta); border:1px solid var(--acento); border-radius:var(--radio); padding:16px; margin-bottom:24px;">
      <h3 style="margin:0 0 8px;">📦 Importar historial completo (Órdenes + Servicios)</h3>
      <p style="color:var(--texto-secundario); font-size:0.85rem; margin:0 0 12px;">
        Para tu archivo real de AlarmasReset (hojas "Órdenes" + "Servicios"). Crea clientes, órdenes con fecha histórica real y sus pagos correspondientes.
      </p>
      <input type="file" id="input-archivo-historico" accept=".xlsx,.xls">
      <div id="zona-importacion-historica"></div>
    </div>

    <h3>Importación genérica de clientes (Excel/CSV cualquiera)</h3>
    <p style="color:var(--texto-secundario); max-width:520px; font-size:0.85rem;">
      Para cualquier otro Excel/CSV con solo datos de clientes. Selecciona tu archivo, mapea las columnas y confirma antes de importar.
    </p>
    <input type="file" id="input-archivo-importar" accept=".xlsx,.xls,.csv" style="margin:14px 0;">
    <div id="zona-importacion"></div>
  `;

  document.getElementById("input-archivo-historico").addEventListener("change", async (e) => {
    const archivo = e.target.files[0];
    if (!archivo) return;
    const zona = document.getElementById("zona-importacion-historica");
    zona.innerHTML = `<div class="skeleton skeleton--vista"></div>`;

    const r = await procesarArchivoHistorico(archivo);
    if (!r.ok) {
      mostrarToast(r.error, "error");
      zona.innerHTML = "";
      return;
    }
    await renderPlanImportacionHistorica(r, zona);
  });

  document.getElementById("input-archivo-importar").addEventListener("change", async (e) => {
    const archivo = e.target.files[0];
    if (!archivo) return;
    const zona = document.getElementById("zona-importacion");
    zona.innerHTML = `<div class="skeleton skeleton--vista"></div>`;

    const r = await procesarArchivo(archivo);
    if (!r.ok) {
      mostrarToast(r.error, "error");
      zona.innerHTML = "";
      return;
    }
    renderMapeoImportacion(r, zona);
  });
}

async function renderPlanImportacionHistorica({ ordenesRaw, serviciosRaw }, zona) {
  const [clientesExistentes, idsYaImportados] = await Promise.all([
    listarClientes({ soloActivos: false, limite: 1000 }),
    obtenerIdsYaImportados(),
  ]);
  const plan = prepararPlanImportacion(ordenesRaw, serviciosRaw, clientesExistentes, idsYaImportados);

  zona.innerHTML = `
    <div class="estado-vacio" style="text-align:left; align-items:flex-start; padding:16px 0;">
      <p>Órdenes detectadas en el archivo: <strong>${plan.totalOrdenes}</strong></p>
      ${plan.yaImportadasOmitidas > 0 ? `<p style="color:var(--acento);">Ya importadas anteriormente (se omiten, no se duplican): <strong>${plan.yaImportadasOmitidas}</strong></p>` : ""}
      <p>Órdenes válidas para importar: <strong style="color:var(--exito);">${plan.ordenesValidas}</strong></p>
      <p>Conceptos/servicios que se importarán: <strong>${plan.totalConceptos}</strong></p>
      <p>Clientes nuevos a crear: <strong>${plan.clientesNuevosCount}</strong></p>
      <p>Clientes existentes reutilizados: <strong>${plan.clientesExistentesReutilizados}</strong></p>
      <p>Se registrarán pagos históricos por: <strong>${fm(plan.totalAImportarComoIngreso)}</strong></p>
      ${plan.erroresOrdenes.length > 0 ? `<p style="color:var(--peligro);">Filas con error (se omiten): ${plan.erroresOrdenes.length}</p>` : ""}
      <button id="btn-confirmar-importacion-historica" class="btn btn--primario" ${plan.ordenesValidas === 0 ? "disabled" : ""}>
        Confirmar e importar ${plan.ordenesValidas} órdenes
      </button>
    </div>
  `;

  document.getElementById("btn-confirmar-importacion-historica")?.addEventListener("click", async () => {
    if (!confirm(`¿Importar ${plan.ordenesValidas} órdenes, ${plan.clientesNuevosCount} clientes nuevos y sus pagos históricos? Esta acción no se puede deshacer automáticamente.`)) return;
    const btn = document.getElementById("btn-confirmar-importacion-historica");
    btn.disabled = true;
    btn.textContent = "Importando...";
    const r = await ejecutarImportacionHistorica(plan);
    if (r.ok) {
      mostrarToast(`Importación completa: ${r.ordenesCreadas} órdenes, ${r.clientesCreados} clientes, ${r.pagosCreados} pagos.`, "exito");
      zona.innerHTML = `<div class="estado-vacio"><p>✅ ${r.ordenesCreadas} órdenes importadas correctamente.</p></div>`;
    } else {
      mostrarToast(r.error, "error");
      btn.disabled = false;
      btn.textContent = "Reintentar";
    }
  });
}

function renderMapeoImportacion(datosArchivo, zona) {
  const { encabezados, filas, previa, totalFilas } = datosArchivo;

  zona.innerHTML = `
    <h3 style="margin-top:16px;">Vista previa (primeras ${previa.length} de ${totalFilas} filas)</h3>
    <div style="overflow-x:auto; margin-bottom:16px;">
      <table style="border-collapse:collapse; font-size:0.8rem; width:100%;">
        <thead><tr>${encabezados.map((h) => `<th style="border:1px solid var(--borde); padding:4px 8px; text-align:left;">${escapeHtml(String(h))}</th>`).join("")}</tr></thead>
        <tbody>
          ${previa.map((fila) => `<tr>${fila.map((c) => `<td style="border:1px solid var(--borde); padding:4px 8px;">${escapeHtml(String(c))}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
    </div>

    <h3>Mapeo de columnas</h3>
    <form id="form-mapeo">
      ${CAMPOS_IMPORTABLES_CLIENTES.map(
        (campo) => `
        <label>${campo.etiqueta}${campo.obligatorio ? " *" : ""}
          <select name="${campo.campo}" ${campo.obligatorio ? "required" : ""}>
            <option value="">— No importar —</option>
            ${encabezados.map((h, idx) => `<option value="${idx}">${escapeHtml(String(h))}</option>`).join("")}
          </select>
        </label>`
      ).join("")}
      <button type="submit" class="btn btn--primario">Validar</button>
    </form>
    <div id="resultado-validacion"></div>
  `;

  document.getElementById("form-mapeo").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const mapeo = {};
    Object.entries(fd).forEach(([campo, valor]) => {
      if (valor !== "") mapeo[campo] = Number(valor);
    });

    const clientesExistentes = await listarClientes({ soloActivos: false, limite: 1000 });
    const { validos, duplicados, errores } = validarYPrepararImportacion(encabezados, filas, mapeo, clientesExistentes);

    const resultado = document.getElementById("resultado-validacion");
    resultado.innerHTML = `
      <div class="estado-vacio" style="text-align:left; align-items:flex-start;">
        <p>Registros detectados: <strong>${filas.length}</strong></p>
        <p>Registros válidos: <strong style="color:var(--exito);">${validos.length}</strong></p>
        <p>Duplicados (se omiten): <strong>${duplicados.length}</strong></p>
        <p>Errores (se omiten): <strong style="color:var(--peligro);">${errores.length}</strong></p>
        ${errores.length > 0 ? `<details><summary>Ver errores</summary><pre style="font-size:0.75rem; white-space:pre-wrap;">${errores.map((e) => `Fila ${e.fila}: ${e.motivos.join(", ")}`).join("\n")}</pre></details>` : ""}
        <button id="btn-confirmar-importacion" class="btn btn--primario" ${validos.length === 0 ? "disabled" : ""}>Confirmar e importar ${validos.length} clientes</button>
      </div>
    `;

    document.getElementById("btn-confirmar-importacion")?.addEventListener("click", async () => {
      if (!confirm(`¿Importar ${validos.length} clientes nuevos? Esta acción no se puede deshacer automáticamente.`)) return;
      const btn = document.getElementById("btn-confirmar-importacion");
      btn.disabled = true;
      btn.textContent = "Importando...";
      const r = await ejecutarImportacionClientes(validos);
      if (r.ok) {
        mostrarToast(`${r.importados} clientes importados correctamente.`, "exito");
        resultado.innerHTML = `<div class="estado-vacio"><p>✅ Importación completada: ${r.importados} clientes agregados.</p></div>`;
      } else {
        mostrarToast(r.error, "error");
        btn.disabled = false;
        btn.textContent = "Reintentar";
      }
    });
  });
}


// ---------------- VISTA: GASTOS ----------------
async function vistaGastos(contenedor) {
  contenedor.innerHTML = `
    <div class="vista-header">
      <h1 class="vista-titulo">Gastos</h1>
      <button id="btn-nuevo-gasto" class="btn btn--primario">+ Nuevo gasto</button>
    </div>
    <div id="resumen-gastos"></div>
    <div id="tabla-gastos" style="margin-top:12px;"></div>
  `;
  document.getElementById("btn-nuevo-gasto").addEventListener("click", () => abrirFormularioGasto());
  await refrescarListaGastos();
}

async function refrescarListaGastos() {
  const resumen = document.getElementById("resumen-gastos");
  const tabla = document.getElementById("tabla-gastos");
  const gastos = await listarGastos();

  resumen.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card"><span class="kpi-card__valor">${fm(totalGastos(gastos))}</span><span class="kpi-card__label">Total registrado</span></div>
    </div>`;

  if (gastos.length === 0) {
    tabla.innerHTML = `
      <div class="estado-vacio">
        <p>No existen gastos registrados todavía.</p>
        <button class="btn btn--primario" onclick="document.getElementById('btn-nuevo-gasto').click()">+ Registrar primer gasto</button>
      </div>`;
    return;
  }

  tabla.innerHTML = `
    <div class="tarjetas-lista">
      ${gastos
        .map(
          (g) => `
        <div class="tarjeta-item">
          <div class="tarjeta-item__principal">
            <strong>${escapeHtml(g.concepto)}</strong>
            <span>${escapeHtml(g.categoria)} · ${escapeHtml(g.metodo)} · ${formatoFechaHora(g.fecha)}</span>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            <strong>${fm(g.importe)}</strong>
            <button class="btn btn--secundario" data-editar-gasto="${g.id}">Editar</button>
            <button class="btn btn--peligro" data-desactivar-gasto="${g.id}">Quitar</button>
          </div>
        </div>`
        )
        .join("")}
    </div>`;

  tabla.querySelectorAll("[data-editar-gasto]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const gasto = gastos.find((g) => g.id === btn.dataset.editarGasto);
      abrirFormularioGasto(gasto);
    })
  );
  tabla.querySelectorAll("[data-desactivar-gasto]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("¿Quitar este gasto del reporte? No se elimina físicamente.")) return;
      const r = await desactivarGasto(btn.dataset.desactivarGasto);
      if (r.ok) {
        mostrarToast("Gasto desactivado.", "exito");
        refrescarListaGastos();
      } else {
        mostrarToast(r.error, "error");
      }
    })
  );
}

function abrirFormularioGasto(gasto = null) {
  const modal = document.getElementById("modal-generico");
  const esEdicion = Boolean(gasto);
  modal.innerHTML = `
    <div class="modal__contenido">
      <h2>${esEdicion ? "Editar gasto" : "Nuevo gasto"}</h2>
      <form id="form-gasto">
        <label>Concepto *
          <input name="concepto" required value="${gasto ? escapeHtml(gasto.concepto) : ""}">
        </label>
        <label>Categoría *
          <select name="categoria" required>
            ${CATEGORIAS_GASTO.map((c) => `<option value="${c}" ${gasto?.categoria === c ? "selected" : ""}>${c.replace("_", " ")}</option>`).join("")}
          </select>
        </label>
        <label>Importe *
          <input name="importe" type="number" min="0.01" step="0.01" required value="${gasto ? gasto.importe : ""}">
        </label>
        <label>Método
          <select name="metodo">
            <option value="efectivo" ${gasto?.metodo === "efectivo" ? "selected" : ""}>Efectivo</option>
            <option value="transferencia" ${gasto?.metodo === "transferencia" ? "selected" : ""}>Transferencia</option>
            <option value="tarjeta" ${gasto?.metodo === "tarjeta" ? "selected" : ""}>Tarjeta</option>
            <option value="otro" ${gasto?.metodo === "otro" ? "selected" : ""}>Otro</option>
          </select>
        </label>
        <label>Proveedor
          <input name="proveedor" value="${gasto ? escapeHtml(gasto.proveedor || "") : ""}">
        </label>
        <label>Notas
          <textarea name="notas">${gasto ? escapeHtml(gasto.notas || "") : ""}</textarea>
        </label>
        <div class="modal__acciones">
          <button type="button" class="btn btn--secundario" id="btn-cancelar-modal">Cancelar</button>
          <button type="submit" class="btn btn--primario">Guardar</button>
        </div>
      </form>
    </div>`;
  modal.classList.add("modal--visible");

  document.getElementById("btn-cancelar-modal").addEventListener("click", cerrarModal);
  document.getElementById("form-gasto").addEventListener("submit", async (e) => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(e.target).entries());
    const r = esEdicion ? await editarGasto(gasto.id, datos) : await crearGasto(datos);
    if (r.ok) {
      mostrarToast(esEdicion ? "Gasto actualizado." : "Gasto registrado correctamente.", "exito");
      cerrarModal();
      refrescarListaGastos();
    } else {
      mostrarToast(r.error, "error");
    }
  });
}


// ---------------- VISTA: CONFIGURACIÓN ----------------
async function vistaConfiguracion(contenedor) {
  const empresa = await obtenerConfiguracionEmpresa({ forzarRecarga: true });
  contenedor.innerHTML = `
    <h1 class="vista-titulo">Configuración de empresa</h1>
    <form id="form-empresa" class="formulario-config">
      <label>Nombre comercial *
        <input name="nombreComercial" required value="${escapeHtml(empresa.nombreComercial)}">
      </label>
      <label>Razón social
        <input name="razonSocial" value="${escapeHtml(empresa.razonSocial)}">
      </label>
      <label>RFC
        <input name="rfc" value="${escapeHtml(empresa.rfc)}">
      </label>
      <label>Teléfono
        <input name="telefono" value="${escapeHtml(empresa.telefono)}">
      </label>
      <label>WhatsApp
        <input name="whatsapp" value="${escapeHtml(empresa.whatsapp)}">
      </label>
      <label>Email
        <input name="email" type="email" value="${escapeHtml(empresa.email)}">
      </label>
      <label>Dirección
        <input name="direccion" value="${escapeHtml(empresa.direccion)}">
      </label>
      <label>Eslogan
        <input name="eslogan" value="${escapeHtml(empresa.eslogan)}">
      </label>
      <label class="switch-label">
        <input type="checkbox" name="ivaActivo" ${empresa.ivaActivo ? "checked" : ""}>
        IVA activado
      </label>
      <label>Porcentaje IVA
        <input name="ivaPorcentaje" type="number" step="0.01" value="${empresa.ivaPorcentaje}">
      </label>
      <label>Vigencia de cotización (días)
        <input name="vigenciaCotizacionDias" type="number" value="${empresa.vigenciaCotizacionDias}">
      </label>
      <button type="submit" class="btn btn--primario">Guardar configuración</button>
    </form>
  `;

  document.getElementById("form-empresa").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const datos = Object.fromEntries(fd.entries());
    datos.ivaActivo = fd.has("ivaActivo");
    datos.ivaPorcentaje = Number(datos.ivaPorcentaje);
    datos.vigenciaCotizacionDias = Number(datos.vigenciaCotizacionDias);

    const r = await guardarConfiguracionEmpresa(datos);
    if (r.ok) mostrarToast("Configuración guardada correctamente.", "exito");
    else mostrarToast(r.error, "error");
  });
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

iniciar();
