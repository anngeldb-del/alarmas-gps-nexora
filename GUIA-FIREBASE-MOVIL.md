# Guía: Configurar Firebase desde tu celular
Para ALARMAS Y GPS — pensada 100% para Chrome en tu Samsung S25 Ultra, sin computadora.

---

## Parte 1 — Crear el proyecto Firebase

1. Abre Chrome y ve a **console.firebase.google.com**
2. Inicia sesión con tu cuenta de Google (recomiendo `anngeldb@gmail.com`, la misma que usas en tus otros proyectos)
3. Toca **"Crear un proyecto"** (o "Agregar proyecto")
4. Nombre del proyecto: `alarmas-gps-nexora` (o el que prefieras — anótalo, lo vas a necesitar)
5. Desactiva Google Analytics si no lo vas a usar (simplifica el setup) → **Crear proyecto**
6. Espera ~30 segundos a que termine → **Continuar**

## Parte 2 — Habilitar Authentication

1. En el menú lateral (ícono ☰ arriba a la izquierda), toca **"Compilación"** → **"Authentication"**
2. Toca **"Comenzar"**
3. En la lista de proveedores, toca **"Correo electrónico/contraseña"**
4. Activa el primer interruptor (Correo electrónico/contraseña) → **Guardar**

## Parte 3 — Habilitar Firestore

1. Menú lateral → **"Compilación"** → **"Firestore Database"**
2. Toca **"Crear base de datos"**
3. Ubicación: elige la más cercana a Torreón, normalmente **`us-central1`** o **`us-east1`** — no la cambies después, no se puede
4. Modo: elige **"Modo de producción"** (más seguro; las reglas las subes tú en la Parte 5)
5. **Crear**

## Parte 4 — Obtener tu firebaseConfig y pegarlo en el proyecto

1. Toca el ⚙️ (ícono de engranaje) junto a "Descripción general del proyecto" → **"Configuración del proyecto"**
2. Baja hasta **"Tus apps"** → toca el ícono **`</>`** (Web)
3. Apodo de la app: `alarmas-gps-web` → **Registrar app**
4. Firebase te muestra un bloque de código con `const firebaseConfig = { ... }` — **cópialo completo** (los 6 campos: apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId)
5. Ahora ve a **github.com** → entra a tu repo `alarmas-gps-nexora`
6. Navega a `js/config.js` → toca el ícono de **lápiz** (editar) arriba a la derecha
7. Reemplaza el bloque `FIREBASE_CONFIG` (las líneas con `"PENDIENTE_..."`) con los valores reales que copiaste de Firebase
8. Baja hasta el final → **"Commit changes..."** → mensaje: `Configurar Firebase real` → **Commit changes**
9. Si usas GitHub Pages, en 1-2 minutos el cambio ya está en vivo en tu URL publicada

## Parte 5 — Subir las reglas de seguridad y los índices

1. En Firebase Console, ve a **Firestore Database** → pestaña **"Reglas"**
2. Borra todo lo que haya ahí
3. Ve a tu repo en GitHub → abre `firestore/firestore.rules` → toca los 3 puntos o mantén presionado el contenido → copia todo el texto
4. Pégalo en Firebase Console (pestaña Reglas) → **"Publicar"**
5. Ve a la pestaña **"Índices"** dentro de Firestore Database
6. Los índices de `firestore.indexes.json` no se pueden pegar directo ahí — la forma más simple desde el celular: **usa la app normalmente**. La primera vez que un filtro necesite un índice que falte, Firestore te va a mostrar un error en la consola del navegador con un **link directo** que crea el índice exacto con un toque. Ve creando los que te vayan apareciendo la primera semana de uso — no son muchos y solo pasa una vez por índice.

## Parte 6 — Crear tu usuario administrador

1. Firebase Console → **Authentication** → pestaña **"Users"** → **"Agregar usuario"**
2. Escribe tu correo y una contraseña → **Agregar usuario**
3. Se crea el usuario — toca sobre él y **copia su "User UID"** (una cadena larga de letras/números)
4. Ve a **Firestore Database** → pestaña **"Datos"** → **"Iniciar colección"**
5. ID de la colección: `usuarios` → Siguiente
6. ID del documento: **pega el User UID que copiaste** (importante: debe ser exactamente ese UID, no lo escribas tú)
7. Agrega estos 2 campos:
   - Campo `rol`, tipo **string**, valor `administrador`
   - Campo `activo`, tipo **boolean**, valor `true`
8. **Guardar**

## Parte 7 — Probar

1. Abre tu app (`login.html`) en el celular
2. Si el banner rojo de "Firebase no configurado" ya no aparece, el Paso 4 funcionó
3. Inicia sesión con el correo/contraseña que creaste en la Parte 6
4. Deberías entrar al Dashboard sin errores

---

## Si algo falla
- **"auth/invalid-api-key"** → revisa que copiaste bien el `firebaseConfig` completo en `js/config.js`, sin comillas de más ni de menos
- **Login dice "Tu cuenta no tiene un perfil asignado"** → falta el documento en `usuarios/{tu UID}` (Parte 6, paso 4-8), o el UID no coincide exactamente
- **Cualquier acción da "Missing or insufficient permissions"** → revisa que publicaste las reglas (Parte 5, paso 1-4) y que tu documento en `usuarios` tiene `activo: true`
- Cópiame el mensaje de error exacto que veas y seguimos desde ahí.
