# ALARMAS Y GPS
Sistema de gestión empresarial — Desarrollado por **NEXORA**
Responsable técnico: Ing. Luis Ángel Díaz Bernal

> Estado actual: **Fases 1 a 6 completadas + rondas de optimización de costo y auditoría de código (secciones 6.10 a 6.17)**. Sistema listo para pruebas en dispositivo real (ver `QA_CHECKLIST.md`).

---

## 1. Qué es esto
App web/PWA para administrar el negocio de alarmas automotrices, GPS, accesorios e instalaciones: clientes, órdenes, cotizaciones, inventario, pagos, adeudos, ingresos y reportes. Arquitectura preparada para reutilizarse con otros negocios (multiempresa) sin tocar código — solo cambiando la configuración en Firestore.

## 2. Por qué esta arquitectura
- **HTML/CSS/JS modular sin build tools**, consistente con tu stack actual (GitHub Pages, sin frameworks pesados). Cada módulo de negocio vive en `js/modules/` y se importa como ES module — nada de un solo HTML gigante.
- **Router hash-based propio** (`js/router.js`): sin dependencias externas, funciona directo en GitHub Pages.
- **Multiempresa real**: nada de nombre/logo/RFC/IVA hardcodeado. Todo se lee de `configuracion/empresa` en Firestore (`js/modules/configuracion.js`), con defaults solo como fallback mientras configuras Firebase.

## 3. Estructura de carpetas
```
index.html          → shell principal (sidebar + router)
login.html           → pantalla de login
manifest.json         → PWA
service-worker.js       → cache offline del shell (nunca cachea datos de Firestore)
css/                → themes.css (paleta+modo oscuro/claro), main.css, responsive.css
js/
  config.js           → ⚠️ AQUÍ VA TU firebaseConfig
  firebase.js          → inicialización única de Firebase
  auth.js             → login/logout/recuperación real
  permissions.js         → matriz de permisos por rol (solo UI, no seguridad real)
  audit.js            → registrarAuditoria() — toda acción crítica pasa por aquí
  folios.js            → generación de folios sin duplicados (transacciones)
  pdf.js              → PDF profesional (jsPDF vía CDN) para cotizaciones/órdenes
  whatsapp.js           → mensajes editables antes de abrir WhatsApp
  router.js            → router hash
  utils.js             → formato moneda/fecha, cálculos financieros centralizados
  app.js              → orquesta sesión + vistas
  modules/
    dashboard.js         → KPIs reales desde Firestore
    clientes.js          → CRUD completo real
    productos.js          → inventario: CRUD + movimientos (entrada/salida/ajuste) transaccionales
    ordenes.js            → órdenes: folio, cálculo de totales, máquina de estados, salida de inventario
    cotizaciones.js        → cotizaciones: folio, estados, edición controlada, conversión a orden
    pagos.js             → pagos parciales, saldo recalculado en transacción, guard contra sobre-pago
    adeudos.js            → vista de adeudos derivada de ordenes (saldo>0), sin colección propia
    ingresos.js            → ingresos derivados de pagos, filtros por periodo
    reportes.js            → reporte mensual agregado real (sin datos inventados)
    gastos.js             → gastos reales por categoría, alimenta la utilidad estimada
    backup.js             → copia de seguridad completa (JSON y Excel)
    auditoria.js           → lectura del log de auditoría
    importacion.js          → importador genérico de clientes desde Excel/CSV
    configuracion.js       → lectura/escritura de configuracion/empresa
excel.js               → exportación/lectura de libros .xlsx (SheetJS)
firestore/
  firestore.rules        → ✅ reglas cerradas (Fase 6) + estadisticas/gastos (Fase 8)
  firestore.indexes.json    → índices compuestos requeridos por las consultas reales
```

## 4. Colecciones de Firestore (Fase 1)
| Colección | Para qué |
|---|---|
| `usuarios/{uid}` | rol (`administrador`/`empleado`/`tecnico`), `activo` |
| `configuracion/empresa` | identidad del negocio, IVA, moneda, etc. |
| `clientes/{id}` | CRUD real, `activo:false` en vez de borrado físico |
| `productos/{id}` | inventario, `stock` solo se modifica vía transacción |
| `movimientosInventario/{id}` | historial inmutable de entradas/salidas/ajustes |
| `ordenes/{id}` | folio, conceptos, totales, estado, técnico asignado |
| `cotizaciones/{id}` | folio, conceptos, totales, estado, referencia a orden si se convirtió |
| `pagos/{id}` | pagos reales; adeudos e ingresos se calculan a partir de aquí, nunca se duplican |
| `auditoria/{id}` | log de acciones críticas, inmutable |
| `folios/{tipo_periodo}` | contador atómico para folios COT-/ORD- |

Colecciones para Fases 2-5 (`ordenes`, `cotizaciones`, `productos`, `pagos`, `ingresos`, `movimientosInventario`, `gastos`) ya están contempladas en `firestore.rules` (borrador) para que no haya que rediseñar seguridad después.

## 5. Roles y permisos
- **Permisos de UI**: `js/permissions.js` — controla qué módulos ve cada rol. Esto **no es seguridad real**, solo evita mostrar botones que el usuario no debería usar.
- **Seguridad real**: vive en `firestore/firestore.rules` (aún borrador, ver punto 7).

## 6. Folios sin duplicados
`js/folios.js` usa `runTransaction` de Firestore sobre un contador por tipo+mes (`folios/cotizacion_2026_08`). Si dos usuarios generan un folio al mismo tiempo, Firestore reintenta automáticamente la transacción perdedora — nunca se repite un número.

## 6.1 Inventario sin doble descuento (Fase 2)
`js/modules/ordenes.js` solo descuenta stock cuando una orden pasa a estado **entregada**, y antes de hacerlo consulta `yaSeDescontoInventario(folio)` en `movimientosInventario`. Si el usuario presiona el botón dos veces, hay un reintento de red, o la app estuvo offline y sincroniza tarde, el segundo intento no vuelve a descontar — solo el primero que efectivamente se registró cuenta. El stock en sí se actualiza con `runTransaction` (`productos.js → registrarMovimiento`), así que dos ventas simultáneas del mismo producto no pueden dejarlo en negativo.

## 6.2 Máquina de estados de órdenes (Fase 2)
Las transiciones válidas están fijas en `TRANSICIONES_VALIDAS` (`ordenes.js`): pendiente → en_proceso → esperando_piezas ⇄ en_proceso → terminada → entregada, y cancelada solo antes de entregar. La UI solo ofrece los siguientes estados válidos desde el estado actual — no se puede saltar de "pendiente" a "entregada" sin pasar por el resto.

## 6.3 Cotizaciones y conversión a orden (Fase 3)
- **PDF real** (`js/pdf.js`): usa jsPDF cargado desde CDN (cdnjs) — no es una captura de pantalla, arma el documento con logo, datos de empresa, tabla de conceptos y footer con NEXORA/Ing. Luis Ángel. Si el CDN no cargó (sin internet), la app te lo dice explícitamente en vez de fallar en silencio.
- **WhatsApp editable** (`js/whatsapp.js`): siempre se muestra un modal con el mensaje antes de abrir `wa.me` — nunca se envía nada sin que lo veas y lo puedas modificar.
- **Edición controlada**: una cotización en estado "aceptada" o "convertida" ya no se puede editar (sección 33) — hay que crear una nueva si algo cambió.
- **Convertir en orden**: solo disponible cuando la cotización está "aceptada". `convertirEnOrden()` reutiliza `crearOrden()` de `ordenes.js` — copia cliente, conceptos, descuento y observaciones sin pedirte que captures nada de nuevo, genera folio ORD- propio, y marca la cotización como "convertida" con referencia cruzada al folio de la orden generada.

## 6.4 Pagos, adeudos e ingresos sin doble fuente de verdad (Fase 4)
- **Pagos parciales**: cada pago se guarda en `pagos/{id}` y el saldo de la orden se recalcula dentro de una `runTransaction` (`pagos.js → registrarPago`), así nunca queda negativo por accidente.
- **Guard contra sobre-pago**: si el importe supera el saldo pendiente, la función devuelve `requiereConfirmacion:true` en vez de guardar; la UI pide una confirmación explícita antes de forzar el registro (sección 35).
- **Adeudos** (`adeudos.js`) NO es una colección aparte — se calcula en vivo a partir de `ordenes` con `saldo > 0`. Esto evita que un campo "saldo" desactualizado mienta sobre cuánto debe un cliente.
- **Ingresos** (`ingresos.js`) tampoco duplica datos: un ingreso ES un pago. Los filtros de periodo (hoy/semana/mes/mes anterior/año) se calculan sobre la misma colección `pagos`.
- **Dashboard financiero**: `dashboard.js` ahora calcula ingresos hoy/mes, órdenes abiertas, cotizaciones pendientes, clientes con adeudo, total por cobrar, ticket promedio y stock bajo — todo en vivo, sin ceros de relleno.

## 6.5 Reportes, Excel, backup e importación (Fase 5)
- **Reporte mensual** (`reportes.js`): agrega datos reales de `ordenes`, `cotizaciones`, `pagos`, `clientes` y `movimientosInventario` para el mes/año que elijas — nunca cifras inventadas; si no hubo actividad, los totales salen en 0.
- **Excel** (`excel.js`, con SheetJS por CDN): exporta el reporte mensual con las 8 hojas que pediste (RESUMEN, VENTAS, ÓRDENES, PAGOS, CLIENTES, INVENTARIO, MOVIMIENTOS INVENTARIO, COTIZACIONES), con anchos de columna automáticos.
- **Backup** (`backup.js`): copia completa de clientes/productos/órdenes/cotizaciones/pagos/movimientos/configuración, en JSON o en Excel multi-hoja, un botón cada uno en Configuración → Copias de seguridad.
- **Auditoría (UI)**: pantalla de solo lectura sobre `auditoria/` — quién hizo qué y cuándo, más reciente primero. Solo visible para el rol administrador.
- **Importación — IMPORTANTE**: como aún no subiste `AlarmasReset-2026-08-13.xlsx`, construí un importador **genérico de clientes**: seleccionas el archivo, ves las primeras 10 filas, mapeas manualmente qué columna es nombre/teléfono/email/etc., el sistema detecta duplicados (por nombre) y filas con errores, te muestra el resumen (`Registros detectados / válidos / duplicados / errores`, igual que pide tu brief) y solo importa lo que confirmes. En cuanto subas el Excel real, lo reviso y agrego mapeos predefinidos para órdenes/productos/pagos si el archivo trae esa información — no hay que rehacer nada, solo extender `importacion.js`.

## 6.6 Importador dedicado al Excel real de AlarmasReset (post-análisis)
Angel subió `AlarmasReset-2026-07-27.xlsx` y su estructura real es **distinta** a lo que el brief original asumía:
- 3 hojas: **Órdenes** (46 filas), **Servicios** (87 filas, relacionadas por `ID Orden`), **Resumen**.
- No hay inventario con SKU — el negocio rastrea **Inversión** (costo real) y **Ganancia** por servicio individual, no por producto en almacén.
- No hay cotizaciones separadas — se trabaja directo con órdenes.
- Solo 2 estados en el origen: PENDIENTE / PAGADO. Se acordó con Angel mapear PAGADO → `entregada` en el sistema nuevo.
- **Hallazgo importante**: en el Excel origen, la columna "Saldo" = Total − A Cuenta *siempre*, incluso en órdenes PAGADO (no baja a 0 al cobrarse el resto). El indicador real de "ya se cobró todo" es el campo Estado, no Saldo. `importacionHistorica.js` corrige esto: las órdenes que se importan como "entregada" se consideran pagadas al 100% (saldo=0), y solo las "pendiente" conservan el saldo real del Excel. Verificado numéricamente contra el propio Resumen del archivo: $165,190 cobrado / $1,850 por cobrar — coincide exacto.
- `js/modules/importacionHistorica.js` (nuevo, distinto del importador genérico de clientes): lee ambas hojas, crea clientes únicos por nombre (reutiliza si ya existen), crea órdenes con **fecha histórica real** (no la fecha de hoy) para que los reportes de meses pasados salgan correctos, copia cada servicio como concepto con sus campos `inversion`/`ganancia`/`garantia`, y genera un registro de pago por cada orden con monto cobrado > 0.
- Disponible en **Importar datos** → sección "📦 Importar historial completo (Órdenes + Servicios)", separada del importador genérico de clientes que ya existía.

## 6.7 Cierre de seguridad y optimización (Fase 6)
- **`firestore/firestore.rules` ya NO es borrador** — están cerradas con los patrones de acceso reales de los 5 módulos. Corregí un conflicto real que hubiera bloqueado la operación diaria: un **empleado** marcando una orden como "entregada" dispara el descuento automático de inventario (Fase 2), así que las reglas ahora dejan que empleados toquen *solo* el campo `stock` de un producto — nunca precio/costo/SKU, eso sigue siendo exclusivo de administrador.
- **`firestore/firestore.indexes.json`** (nuevo): los índices compuestos que tus consultas van a necesitar (clientes activos ordenados por nombre, órdenes por estado+fecha, pagos por orden+fecha, etc.). Súbelos junto con las reglas — si no, Firestore te va a tirar error la primera vez que uses un filtro, con un link para crear el índice manualmente; con este archivo ya no hace falta.
- **Búsqueda global** (sección 47, `js/modules/busqueda.js`): quedó pendiente en fases anteriores, ya está lista — input en la barra lateral, busca en clientes/órdenes/cotizaciones/productos a la vez, resultados agrupados y clicables, con debounce para no saturar Firestore mientras escribes.
- **`QA_CHECKLIST.md`** (nuevo): checklist de las 22 pruebas de la sección 69 de tu brief, con lo que ya está cubierto por lógica de código (validado por inspección) vs. lo que solo se puede confirmar probando en tu celular con Firebase conectado.

### ✅ Resuelto en Fase 8 (antes era una limitación conocida)
Un usuario con rol "técnico" ya NO ve "+ Nueva orden" ni "Editar" en Órdenes — solo puede cambiar el estado de las que tiene asignadas, que es su permiso real de negocio. Tampoco ve "Registrar pago" en ninguna orden. Esto se corrigió en la auditoría de Fase 8 (ver sección 6.13, punto 2) junto con el hallazgo de que el sistema de roles no se aplicaba de verdad hasta esa misma ronda (sección 6.15).

## 6.8 Gastos (extra, cierra la sección 37 del brief)
El módulo de gastos estaba "preparado en la arquitectura pero sin capturar" desde Fase 1. Ya está construido: CRUD real por categoría (renta, servicios, sueldos, materiales, combustible, mantenimiento, publicidad, impuestos, otro), completamente separado de `ingresos` (nunca se mezclan en el mismo cálculo), y ahora **`reportes.js` usa el gasto real del mes** en vez de un placeholder fijo en 0 — la "Utilidad estimada" de tu reporte mensual ya es Ingresos − Costo de productos usados − Gastos reales. Solo administrador puede ver/registrar gastos (información financiera sensible), tanto en `permissions.js` (UI) como en `firestore.rules` (seguridad real).

## 6.9 Inventario oculto del menú (decisión de Angel)
El módulo de Inventario/productos (Fase 2) sigue construido y funcional — código, colección `productos`, reglas de Firestore — pero se **ocultó del menú lateral** porque el negocio real (confirmado con `AlarmasReset-2026-07-27.xlsx`) no usa SKU/stock, sino Costo/Inversión/Ganancia por servicio individual. El selector de "producto" al armar conceptos de una orden/cotización sigue ahí (por si algún día se usa), simplemente no tendrá opciones mientras la lista de productos esté vacía — no rompe nada.

**Para reactivarlo en el futuro** (por ejemplo si empiezas a vender refacciones con control de almacén formal): en `js/app.js`, busca la línea comentada `// inventario: "Inventario",` dentro de `NOMBRES_MODULO` y quítale el `//`. Un solo cambio, sin reconstruir nada.

## 6.10 Optimización de costo de Firebase (Fase 7)
Firebase Firestore cobra por **documento leído**, sin importar si tu proyecto está en el plan gratuito (Spark, con cuota diaria) o de pago (Blaze). El punto de partida ya era razonable — nunca se usó `onSnapshot` (los listeners en tiempo real son la causa #1 de facturas sorpresa, porque quedan escuchando cambios todo el tiempo que la app está abierta) — pero encontré 4 patrones que hacían crecer el costo sin necesidad, sobre todo conforme pase el tiempo y se acumule historial:

1. **`ingresos.js` traía TODA la colección `pagos`, siempre.** `listarIngresos()` hacía `getDocs` sin ningún filtro y luego filtraba por fecha en el navegador. Cada vez que abrías el Dashboard (que llama esto dos veces: "hoy" y "mes") se leía tu historial completo de pagos, para siempre creciente. **Ahora** el rango de fecha se manda como `where()` a Firestore — solo se leen (y se cobran) los pagos que realmente caen en el periodo pedido.
2. **El Dashboard duplicaba la consulta de pagos.** Pedía "hoy" y "mes" por separado. Como hoy siempre es parte del mes actual, ahora se pide el mes UNA vez y "hoy" se calcula en memoria a partir de esos mismos datos — la mitad de las lecturas de pagos en cada carga del Dashboard.
3. **Contar órdenes/cotizaciones traía los documentos completos solo para contarlos.** `ordenesAbiertas` y `cotizacionesPendientes` traían hasta 500 documentos completos de cada colección. Ahora usan `getCountFromServer()`, una función de Firestore que cuenta en el servidor sin descargar los documentos — cuesta aproximadamente 1 lectura sin importar si hay 10 órdenes o 10,000.
4. **`reportes.js` traía las 6 colecciones completas en cada reporte.** Igual que el punto 1: sin filtro, filtrando por mes en el navegador. Ahora cada colección se consulta con `where(fecha >=, <=)` acotado al mes exacto que pediste — un reporte de agosto 2026 solo lee documentos de agosto 2026, sin importar cuántos años de historial acumules.
5. **La búsqueda global podía disparar hasta 1,200 lecturas por búsqueda** (300 documentos × 4 colecciones, sin caché). Se bajó a 150 por colección y se agregó `js/cache.js`: una caché en memoria de 20 segundos que evita repetir la misma consulta si buscas varias veces seguidas, o si abres el formulario de "Nueva orden/cotización" poco después de buscar (comparten la misma caché de clientes/productos). La caché se invalida automáticamente en cuanto creas o editas un cliente/producto, para que nunca veas datos viejos.

**Lo que NO se tocó a propósito:** `backup.js` sigue leyendo las colecciones completas — es correcto, porque un respaldo por definición necesita todo, y es una acción que tú disparas manualmente cuando la necesitas, no algo que se ejecuta cada vez que abres la app.

**Ninguno de estos cambios requiere índices nuevos** en `firestore.indexes.json` — los filtros de fecha son sobre un solo campo, que Firestore indexa automáticamente. Los conteos con `getCountFromServer` tampoco los necesitan.

**Cómo vigilar tu consumo real:** Firebase Console → tu proyecto → ⚙️ Uso y facturación (Usage and billing), o dentro de Firestore Database → pestaña "Uso" — ahí ves lecturas/escrituras por día. Con el tamaño actual de tu negocio (18 clientes, ~46 órdenes) vas a estar muy por debajo de la cuota gratuita diaria incluso sin estas optimizaciones; el valor real de estos cambios se nota cuando el historial crezca con los meses.

## 6.11 Indicador de conexión visible (cierra la sección 55, quedó pendiente desde Fase 1)
Firestore ya tenía persistencia offline silenciosa desde el principio (`enableIndexedDbPersistence` en `firebase.js`) — funcionaba, pero no avisaba nada en pantalla. Ahora `js/offline.js` agrega un indicador visible en el pie de la barra lateral: 🟢 En línea / 🟠 Sin conexión / 🔄 Sincronizando / ⚠️ Error de sincronización, más un toast automático ("Conexión restaurada — tus cambios ya se sincronizaron") cuando vuelve el internet.

## 6.12 Tres mejoras adicionales (a petición de Angel)

**1. Cotizaciones vencidas automáticas.** Antes una cotización solo pasaba a "vencida" si la marcabas a mano. Ahora, cada vez que abres la vista de Cotizaciones, `revisarYMarcarVencidas()` revisa las que están en borrador/enviada/vista y las pasa a "vencida" solas si ya venció su `vigenciaHasta` — consulta barata (solo trae esas 3, no la colección completa) y te avisa con un toast cuántas se marcaron.

**3. Paginación real con "Cargar más".** Clientes, Órdenes y Cotizaciones ya no bajan todo de un jalón: piden páginas de 30 con el cursor `startAfter` de Firestore. Con tus 18 clientes y ~46 órdenes no se nota hoy, pero si en un año tienes cientos de registros, cada vista solo lee lo que realmente se muestra en pantalla — el botón "Cargar más" pide la siguiente página bajo demanda. Crear/editar/pagar reinicia la paginación a la primera página para que veas el cambio reflejado de inmediato.

**5. Deduplicación más inteligente en los importadores.** Antes comparaba nombres exactos (`"José Pérez"` ≠ `"jose perez"`). Ahora ambos importadores (genérico de clientes e histórico de Órdenes+Servicios) normalizan quitando acentos, pasando a minúsculas y colapsando espacios extra antes de comparar — detecta más duplicados reales sin falsos positivos.

## 6.13 Auditoría de código — fallos reales corregidos (Fase 8)

Revisión completa buscando bugs de lógica, no solo estilo. Se encontraron y corrigieron 3 fallos reales:

**1. Integridad financiera: el campo "Anticipo" se podía sobrescribir editando una orden, sin pasar por Pagos.**
`totalPagadoDeOrden()` existía en `pagos.js` pero nunca se usaba — el formulario de EDICIÓN de una orden dejaba escribir directamente el campo "Anticipo", lo que podía desincronizar el saldo mostrado de los pagos reales guardados en Firestore (sin crear un pago, sin auditoría). Corregido:
- Toda orden nace con `saldo = total` (sin pagos todavía).
- El anticipo capturado al CREAR una orden ahora se registra como un pago real y auditado (vía `registrarPago()`), no como un número suelto.
- Al EDITAR una orden, el saldo se recalcula siempre contra la suma real de pagos en Firestore (`totalPagadoDeOrden()`) — nunca contra el formulario. El campo "Anticipo" ya no es editable en modo edición; se muestra de solo lectura con una nota de que los pagos nuevos van por "Registrar pago".

**2. Permisos de UI nunca se aplicaban.** La función `puede()` estaba importada en `app.js` pero jamás se llamaba — cualquier usuario logueado veía todos los botones de crear/editar/pagar sin importar su rol (el control por módulo en el menú lateral sí funcionaba, pero dentro de cada vista no había ningún filtro). Corregido: "Nuevo cliente"/Editar/Desactivar ahora respetan `puede(rol,'clientes','w')`; "Registrar pago" respeta `puede(rol,'pagos','w')`; y técnico ya no ve "+ Nueva orden" ni "Editar" en Órdenes (solo debe cambiar el estado de las que tiene asignadas, no crear ni editar el detalle completo).

**3. Caché compartida con límites inconsistentes.** La búsqueda global guardaba clientes/productos en caché con límite 150, pero el formulario de "Nueva orden/cotización" guardaba la misma clave de caché con el límite por defecto (50) — dependiendo de quién la llenara primero, la otra vista podía quedarse con menos resultados de los esperados. Unificado a 150 en ambos lugares.

## 6.14 Optimización de lecturas de Firestore, ronda 2 (patrón de contador acumulado)

La ronda anterior (Fase 7) ya cortó el consumo en Ingresos/Reportes/Dashboard/Búsqueda. Esta ronda ataca el único patrón que seguía creciendo con el historial:

**Ticket promedio: de "leer 100 órdenes" a "leer 1 documento", para siempre.**
Calcular el ticket promedio necesitaba descargar hasta 100 órdenes entregadas cada vez que abrías el Dashboard — un costo que solo iba a crecer conforme pasaran los años. Ahora `ordenes.js` mantiene un documento `estadisticas/global` con `sumaTotalEntregadas` y `cantidadEntregadas`, actualizado con `increment()` cada vez que una orden se marca "entregada" (y también durante la importación histórica, para que tus 44 órdenes ya entregadas cuenten desde el día uno). El Dashboard ahora lee ese único documento: **1 lectura, sin importar si tu negocio lleva 1 mes o 10 años de historial.**

**Stock bajo: cuenta antes de descargar.** Antes se bajaban hasta 300 documentos de productos para comparar stock contra el mínimo. Ahora primero se CUENTA cuántos productos activos hay (`getCountFromServer`, ~1 lectura); si son 0 (tu caso actual, con Inventario oculto), ahí termina — nunca se descarga nada.

**Reportes: la hoja "CLIENTES" del Excel ahora es perezosa.** Antes, solo con ABRIR la pantalla de Reportes ya se leían hasta 500 clientes completos (para una hoja del Excel que la mayoría de las veces ni se exporta). Ahora esa lista se pide únicamente cuando de verdad das clic en "Exportar Excel".

**Dashboard cacheado 30 segundos.** Todo el paquete de KPIs del Dashboard (la pantalla más visitada) se cachea 30s — si navegas a otra vista y regresas rápido, no se vuelve a leer nada. Se invalida automáticamente en cuanto registras un pago, creas una orden/cotización, o cambias su estado, para que nunca veas números viejos después de hacer algo.

**Resultado esperado:** con el tamaño actual de tu negocio, el consumo diario de lecturas debería mantenerse muy por debajo de la cuota gratuita de Firebase (Spark) incluso después de años de operación — el diseño ya no tiene ningún punto donde el costo crezca sin límite con el historial acumulado.

## 6.15 El fallo más importante de esta auditoría: los roles no se aplicaban de verdad

Al conectar `puede()` a la interfaz (sección 6.13, punto 2) descubrí que la corrección no iba a funcionar en la práctica: **`sesionActual.perfil` nunca se cargaba en `index.html`**. El perfil (con el `rol` real del usuario) solo se leía una vez, en el momento del login — pero se perdía al navegar a `index.html`, donde `renderNav()` y todo el resto de la app caían en un `|| "administrador"` de respaldo. Es decir: **cualquier usuario, sin importar su rol real en Firestore, veía y usaba la app como administrador.**

Corregido de raíz:
- Nueva función reutilizable `obtenerPerfilUsuario(uid)` en `auth.js` (con caché de 60s — el rol casi nunca cambia en medio de una sesión).
- `app.js` ahora espera el perfil real ANTES de pintar cualquier vista. Si el usuario está autenticado en Firebase Auth pero no tiene perfil en Firestore (o está desactivado), se cierra la sesión y se regresa al login — nunca entra "como si fuera admin por accidente".
- El valor de respaldo cambió de `"administrador"` (el más permisivo) a `"tecnico"` (el más restrictivo) — principio de mínimo privilegio: si algo falla, el sistema se equivoca hacia el lado seguro, no hacia el peligroso.

Con esto, los permisos por rol que se agregaron en 6.13 (ocultar "Nuevo cliente"/"Registrar pago"/"Nueva orden" según el rol) **ya funcionan de verdad** — antes solo existían en el código pero nunca se activaban.

## 6.16 Idempotencia del importador histórico
Si corrías el importador de "Órdenes + Servicios" dos veces por accidente, antes se duplicaban las 46 órdenes, sus pagos, y el contador de estadísticas. Ahora `obtenerIdsYaImportados()` revisa qué `origenExcelId` ya se importaron (consulta barata, acotada a órdenes marcadas `importadoDeExcel==true`) y los omite automáticamente, avisándote en pantalla cuántos se saltaron. Puedes correr el importador las veces que quieras sin miedo a duplicar nada.

## 6.17 Auditoría de código, ronda 2

**Bug funcional: no se podía ajustar el stock a 0.** El campo "Cantidad" del formulario de movimiento de inventario tenía `min="1"` fijo sin importar el tipo, y `registrarMovimiento()` en `productos.js` rechazaba `cantidad=0` para cualquier tipo — incluyendo "Ajuste (fijar stock exacto)", donde 0 es un valor perfectamente válido ("ya no queda nada de esto"). Corregido en ambos lados: el mínimo del campo ahora cambia dinámicamente según el tipo elegido, y la validación del backend permite 0 específicamente para ajustes (pero sigue exigiendo cantidad&gt;0 para entradas/salidas, donde mover "0 unidades" no tiene sentido).

**Verificación cruzada de imports/exports.** Se escribió un script que revisa CADA `import { x } from './modulo.js'` en todo el proyecto y confirma que `x` de verdad se exporta desde ese archivo — un tipo de error que `node --check` no detecta (valida sintaxis, no que los nombres realmente existan). Resultado: **cero imports rotos** en las 44 archivos del proyecto.

**Brecha de seguridad: desactivar un usuario no lo saca de la app al instante.** Como este proyecto no tiene backend/Cloud Functions (solo Firestore + Auth desde el cliente), no hay forma de forzar el cierre de sesión de alguien al momento exacto en que lo desactivas. Antes, un usuario con la app ya abierta seguía operando con sus permisos viejos indefinidamente, hasta que recargara la página por su cuenta. Ahora hay una revisión automática cada 5 minutos: si el perfil del usuario fue desactivado, se cierra su sesión con aviso; si le cambiaste el rol, la app se recarga sola para reflejarlo. No es instantáneo, pero acota el riesgo a una ventana máxima razonable sin necesitar servidor propio.

**Revisión de XSS.** Se revisaron todos los puntos donde texto libre del usuario (nombres, notas, observaciones, conceptos, motivos) se inserta en `innerHTML` — todos pasan por `escapeHtml()` antes de insertarse. No se encontraron puntos sin escapar.

## 7. ⚠️ Configuración pendiente que TÚ debes hacer
1. **Crear proyecto Firebase** en https://console.firebase.google.com
2. Habilitar **Authentication → Email/Password**
3. Habilitar **Cloud Firestore**
4. Copiar el `firebaseConfig` de tu proyecto y pegarlo en `js/config.js` (reemplaza los `"PENDIENTE_..."`)
5. Crear manualmente en Firestore tu primer usuario admin:
   - Crea el usuario en Authentication (email/password)
   - Crea un documento en `usuarios/{ese-uid}` con `{ rol: "administrador", activo: true }`
6. **Reglas de Firestore**: quedaron como borrador a propósito (pediste dejarlas para el final). Cuando terminemos Fases 2-5 las revisamos juntos contra los patrones de acceso reales y las subimos en Firebase Console → Firestore Database → Reglas. **Mientras tanto, si despliegas con las reglas por defecto de Firebase (bloqueo total), nada leerá/escribirá — es la opción segura para no exponer datos.**
7. **Excel de referencia** (`AlarmasReset-2026-08-13.xlsx`): no fue subido. Súbelo cuando lo tengas a la mano — lo necesito para diseñar el importador de la Fase 5 (sección 45 del brief) sin inventar columnas.
8. Icono PWA: por ahora `manifest.json` usa el logo JPG directo. Para una instalación más pulida en Android, conviene generar PNGs 192x192 y 512x512 con fondo sólido — lo hacemos cuando quieras.

## 8. Cómo probar ahora mismo (sin Firebase configurado)
Puedes abrir `index.html`/`login.html` para ver el diseño y la navegación, pero **el login y todo lo que dependa de datos no funcionará** hasta que completes el punto 7 — verás un banner rojo avisándolo. Esto es intencional: la app nunca finge que algo se guardó cuando no se guardó (sección 60/82 del brief).

## 9. Despliegue en GitHub Pages
```bash
git init
git add .
git commit -m "Fase 1: fundación ALARMAS Y GPS"
git branch -M main
git remote add origin https://github.com/anngeldb-del/alarmas-gps-nexora.git
git push -u origin main
```
Luego: repo → Settings → Pages → Branch: `main` → Save. (Mismo patrón que ya usas en tus otros proyectos.)

## 10. Roadmap de fases (según tu propio brief, sección 67)
- ✅ **Fase 1 — Fundación**: arquitectura, Firebase, login, roles, dashboard, configuración, clientes.
- ✅ **Fase 2 — Operación**: productos, inventario, órdenes, estados, stock, movimientos.
- ✅ **Fase 3 — Comercial**: cotizaciones, folios, IVA, PDF, WhatsApp, conversión a orden.
- ✅ **Fase 4 — Finanzas**: pagos, pagos parciales, adeudos, ingresos, dashboard financiero.
- ✅ **Fase 5 — Reportes**: reporte mensual, exportación Excel, backup JSON/Excel, auditoría (UI), importador genérico de clientes.
- ✅ **Fase 6 — Optimización**: `firestore.rules` cerradas, índices compuestos (`firestore.indexes.json`), búsqueda global, checklist de pruebas (`QA_CHECKLIST.md`).

## 11. Qué falta para considerarlo "terminado" (tu propia definición, sección 88)
El flujo completo Cliente → Cotización → Orden → Inventario → Pago → Ingreso → Adeudo → Reporte → PDF/Excel aún no existe de extremo a extremo — eso es exactamente el contenido de las Fases 2-5. Fase 1 te da la base sólida (auth real, roles, auditoría, folios sin duplicados, multiempresa) para construir el resto sin retrabajo.
