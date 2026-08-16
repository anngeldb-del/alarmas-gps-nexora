/**
 * modules/auditoria.js — Lectura del log de auditoría (solo admin, ver
 * firestore.rules borrador). Este módulo es de solo lectura; la escritura
 * vive en js/audit.js y se llama desde cada acción crítica.
 */
import {
  collection,
  getDocs,
  query,
  orderBy,
  limit as fsLimit,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db, FIREBASE_CONFIGURED } from "../firebase.js";

export async function listarAuditoria(limite = 100) {
  if (!FIREBASE_CONFIGURED) return [];
  try {
    const q = query(collection(db, "auditoria"), orderBy("fecha", "desc"), fsLimit(limite));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("Error listando auditoría:", err);
    return [];
  }
}
