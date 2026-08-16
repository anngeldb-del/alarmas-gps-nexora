/**
 * auth.js — Autenticación real contra Firebase Auth.
 * No hay simulaciones: si Firebase no está configurado, cada función
 * devuelve un error explícito en vez de fingir éxito.
 */
import {
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { auth, db, FIREBASE_CONFIGURED } from "./firebase.js";
import { registrarAuditoria } from "./audit.js";
import { conCache } from "./cache.js";

function requireFirebase() {
  if (!FIREBASE_CONFIGURED) {
    throw new Error(
      "Firebase no está configurado (js/config.js). No es posible iniciar sesión."
    );
  }
}

/**
 * Lee usuarios/{uid} (rol, activo). Se usa tanto en el login como al
 * detectar la sesión en index.html — cacheado 60s porque el rol de un
 * usuario casi nunca cambia en medio de una sesión de uso, y así no se
 * relee este documento en cada recarga de la app.
 */
export async function obtenerPerfilUsuario(uid) {
  if (!FIREBASE_CONFIGURED || !uid) return null;
  return conCache(
    `perfil:${uid}`,
    async () => {
      const snap = await getDoc(doc(db, "usuarios", uid));
      return snap.exists() ? snap.data() : null;
    },
    60000
  );
}

/**
 * Inicia sesión. Devuelve { ok: true, user } o { ok: false, error }.
 * Nunca lanza al llamador; el llamador decide cómo mostrar el error.
 */
export async function iniciarSesion(email, password) {
  try {
    requireFirebase();
    const cred = await signInWithEmailAndPassword(auth, email, password);

    const perfil = await obtenerPerfilUsuario(cred.user.uid);

    if (!perfil) {
      await signOut(auth);
      return {
        ok: false,
        error:
          "Tu cuenta no tiene un perfil de usuario asignado en el sistema. Contacta al administrador.",
      };
    }

    if (perfil.activo === false) {
      await signOut(auth);
      return { ok: false, error: "Esta cuenta está desactivada." };
    }

    await registrarAuditoria({
      accion: "inicio_sesion",
      modulo: "auth",
      datos: { email: cred.user.email },
    });

    return { ok: true, user: cred.user, perfil };
  } catch (err) {
    return { ok: false, error: traducirErrorAuth(err) };
  }
}

export async function cerrarSesion() {
  try {
    requireFirebase();
    await registrarAuditoria({ accion: "cierre_sesion", modulo: "auth" });
    await signOut(auth);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: traducirErrorAuth(err) };
  }
}

export async function recuperarContrasena(email) {
  try {
    requireFirebase();
    await sendPasswordResetEmail(auth, email);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: traducirErrorAuth(err) };
  }
}

/**
 * Observa cambios de sesión. callback(user | null)
 */
export function observarSesion(callback) {
  if (!FIREBASE_CONFIGURED) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

function traducirErrorAuth(err) {
  const codigo = err?.code || "";
  const mapa = {
    "auth/invalid-email": "El correo electrónico no es válido.",
    "auth/user-disabled": "Esta cuenta está deshabilitada.",
    "auth/user-not-found": "No existe una cuenta con ese correo.",
    "auth/wrong-password": "Contraseña incorrecta.",
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
    "auth/too-many-requests":
      "Demasiados intentos fallidos. Intenta de nuevo más tarde.",
    "auth/network-request-failed":
      "Sin conexión a internet. Verifica tu red e intenta de nuevo.",
  };
  return mapa[codigo] || `No fue posible completar la operación (${codigo || err.message}).`;
}
