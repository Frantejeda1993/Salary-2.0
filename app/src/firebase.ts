import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";

// Configuración web de Firebase: pública por diseño (viaja dentro de la app).
// La seguridad la imponen las reglas de Firestore (firestore.rules en la raíz del repo).
// Sin Analytics a propósito: es una app de finanzas personales.
const firebaseConfig = {
  apiKey: "AIzaSyBmTORbMK58tQTAIzbIhpMLn5W8PzDLH1A",
  authDomain: "salary2-ee33e.firebaseapp.com",
  projectId: "salary2-ee33e",
  storageBucket: "salary2-ee33e.firebasestorage.app",
  messagingSenderId: "553645072389",
  appId: "1:553645072389:web:8b53cf9ca48aacdea7bc6c",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Caché persistente: la app funciona sin conexión y sincroniza al volver la señal.
export const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const IS_MOCK = import.meta.env.VITE_MOCK === "1";
