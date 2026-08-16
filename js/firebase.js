/**
 * firebase.js
 * Inicializa Firebase UNA sola vez y exporta las instancias.
 * Todo el resto del código importa desde aquí — nunca vuelve a llamar
 * initializeApp().
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  enableIndexedDbPersistence,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

import { FIREBASE_CONFIG, FIREBASE_CONFIGURED } from "./config.js";

export { FIREBASE_CONFIGURED };

let app = null;
let auth = null;
let db = null;

if (FIREBASE_CONFIGURED) {
  app = initializeApp(FIREBASE_CONFIG);
  auth = getAuth(app);
  db = getFirestore(app);

  // Sesión persistente en el dispositivo (requerido: "recordar sesión")
  setPersistence(auth, browserLocalPersistence).catch((err) => {
    console.error("No se pudo configurar persistencia de sesión:", err);
  });

  // Cache offline (requerido para modo offline responsable, sección 55)
  enableIndexedDbPersistence(db).catch((err) => {
    if (err.code === "failed-precondition") {
      console.warn(
        "Persistencia offline no disponible: hay otra pestaña abierta con la app."
      );
    } else if (err.code === "unimplemented") {
      console.warn("Este navegador no soporta persistencia offline.");
    }
  });
} else {
  console.warn(
    "⚠️ Firebase NO está configurado. Edita js/config.js con tu firebaseConfig real. " +
      "La app se mostrará pero ninguna operación de datos funcionará hasta configurarlo."
  );
}

export { app, auth, db };
