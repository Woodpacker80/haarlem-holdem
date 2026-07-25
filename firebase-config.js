// Shared Firebase bootstrap for all three screens (phone / tablet / tv).
// Phase 1 scope: anonymous auth + Realtime Database only.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, set, push, onValue, onChildAdded,
  serverTimestamp, onDisconnect, query, limitToLast
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCPRMrsGiug8aVdl1KmoksEgjWVuzwTxSM",
  authDomain: "haarlem-hold--m.firebaseapp.com",
  databaseURL: "https://haarlem-hold--m-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "haarlem-hold--m",
  storageBucket: "haarlem-hold--m.firebasestorage.app",
  messagingSenderId: "322129261822",
  appId: "1:322129261822:web:d54106214754c9280b61af"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

// Fixed test room for Phase 1 — real room creation/joining is Phase 4.
export const ROOM = "test-room";

export function roomRef(path = "") {
  return ref(db, `rooms/${ROOM}${path ? "/" + path : ""}`);
}

// Signs this device in anonymously and resolves with the uid.
export function ensureAuth() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, (user) => {
      if (user) { resolve(user.uid); return; }
      signInAnonymously(auth).catch((err) => console.error("Anon auth failed:", err));
    });
  });
}

// Registers presence for `role` (phone/tablet/tv), auto-clearing on disconnect.
export function registerPresence(role) {
  const presenceRef = roomRef(`presence/${role}`);
  const connectedRef = ref(db, ".info/connected");
  onValue(connectedRef, (snap) => {
    if (snap.val() === true) {
      onDisconnect(presenceRef).remove();
      set(presenceRef, { online: true, since: serverTimestamp() });
    }
  });
  return presenceRef;
}

export function watchPresence(cb) {
  onValue(roomRef("presence"), (snap) => cb(snap.val() || {}));
}

export function sendAction(role, type, payload = {}) {
  return push(roomRef("actions"), { role, type, ...payload, sentAt: serverTimestamp() });
}

export function watchActions(cb) {
  const q = query(roomRef("actions"), limitToLast(1));
  onChildAdded(q, (snap) => cb(snap.val()));
}

export function watchConnection(cb) {
  onValue(ref(db, ".info/connected"), (snap) => cb(snap.val() === true));
}
