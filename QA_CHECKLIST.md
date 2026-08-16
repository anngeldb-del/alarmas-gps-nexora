# Checklist de pruebas — ALARMAS Y GPS
Antes de usar esto todos los días con clientes reales, corre esta lista en tu celular (mapea 1:1 a la sección 69 de tu brief original).

> Cubierto por lógica de código = la validación/regla ya existe y se probó por inspección. Necesita prueba en vivo = requiere Firebase conectado y probar con el dedo en el celular — no se puede verificar sin backend real.

| # | Prueba | Estado |
|---|---|---|
| 1 | Crear cliente | Necesita prueba en vivo (código listo: `clientes.js`) |
| 2 | Crear producto | Necesita prueba en vivo (código listo: `productos.js`) |
| 3 | Crear cotización | Necesita prueba en vivo (código listo: `cotizaciones.js`) |
| 4 | Editar cotización | ✅ Bloqueada si está "aceptada"/"convertida" — probado por inspección |
| 5 | Generar PDF | Necesita prueba en vivo (depende de que cargue jsPDF vía CDN en tu conexión) |
| 6 | Compartir cotización | Necesita prueba en vivo (Web Share API varía por navegador Android) |
| 7 | Convertir cotización en orden | ✅ Solo permitido si estado="aceptada" — probado por inspección |
| 8 | Descontar inventario | ✅ Solo al marcar "entregada", con guard `yaSeDescontoInventario` — probado por inspección |
| 9 | Registrar anticipo | Necesita prueba en vivo — **cambió en Fase 8**: el anticipo capturado al crear una orden ahora genera un pago real y auditado (no solo un número en el formulario) |
| 10 | Registrar pago parcial | ✅ Lógica de saldo en transacción — probado por inspección; falta prueba en vivo |
| 11 | Liquidar orden | Necesita prueba en vivo (pagar hasta saldo=0) |
| 12 | Verificar saldo | ✅ `calcularSaldo()` nunca deja negativo — probado por inspección |
| 13 | Cancelar documento | ✅ Solo desde estados permitidos por la máquina de estados |
| 14 | Intentar duplicar folio | ✅ `runTransaction` en `folios.js` lo previene estructuralmente |
| 15 | Intentar vender más stock del disponible | ✅ `registrarMovimiento` rechaza si stockNuevo < 0 |
| 16 | Cerrar sesión | Necesita prueba en vivo |
| 17 | Ingresar con otro rol | Necesita prueba en vivo — **cambió en Fase 8**: antes el rol no se aplicaba de verdad fuera del login (bug corregido, ver README 6.15); ahora sí restringe botones reales |
| 18 | Trabajar sin conexión | Necesita prueba en vivo — el Service Worker cachea el shell, pero Firestore offline depende del navegador |
| 19 | Recuperar conexión | Necesita prueba en vivo |
| 20 | Exportar Excel | Necesita prueba en vivo (depende de que cargue SheetJS vía CDN) |
| 21 | Importar Excel | Necesita prueba en vivo — **ya validado numéricamente** contra tu archivo real (ver README sección 6.6): $165,190 cobrado / $1,850 por cobrar coincide exacto |
| 22 | Revisar auditoría | Necesita prueba en vivo (vista de solo lectura ya construida) |
| 23 | Ajustar stock de un producto a 0 | ✅ Corregido en Fase 8 (antes lo bloqueaba por error) — probado por inspección |
| 24 | Cotización vence sola después de su fecha límite | ✅ `revisarYMarcarVencidas()` se ejecuta al abrir Cotizaciones — probado por inspección; falta prueba en vivo con una fecha ya vencida |
| 25 | Correr el importador histórico dos veces seguidas | ✅ Segunda corrida debe mostrar "Ya importadas anteriormente" y omitirlas — probado por inspección (`obtenerIdsYaImportados`) |
| 26 | Ticket promedio del Dashboard tras entregar varias órdenes | Necesita prueba en vivo — verificar que `estadisticas/global` se actualice y el promedio sea correcto |
| 27 | Desactivar un usuario mientras tiene la app abierta en otro dispositivo | Necesita prueba en vivo — debe cerrarle la sesión en máximo 5 minutos (ver README 6.17) |
| 28 | Indicador de conexión (🟢/🟠/🔄) | Necesita prueba en vivo — apaga el WiFi/datos del celular y confirma que cambia a "Sin conexión" |

## Cómo correr esta lista
1. Completa la configuración de Firebase (README sección 7).
2. Crea al menos 2 usuarios de prueba: uno "administrador" y uno "empleado", para probar la prueba #17.
3. Ve marcando cada fila conforme la pruebes en tu celular real (no en escritorio — la app está diseñada mobile-first).
4. Cualquier falla, repórtala con: qué botón presionaste, qué esperabas, qué pasó realmente, y si aparece algún mensaje de error (⚠️) cópialo completo.
