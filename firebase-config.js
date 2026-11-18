// =========================================================
// PINO FACU · Configuración de Firebase para los remates
// =========================================================
//
// Mientras PF_FIREBASE_CONFIG sea null, los remates funcionan en
// MODO DEMOSTRACIÓN: lo que se carga en el admin queda guardado solo
// en ese navegador y no se publica para nadie más.
//
// Para publicar de verdad, reemplazá null por los datos web de tu
// proyecto (Firebase › Configuración del proyecto › Tus apps) y
// completá el UID del usuario administrador. Ejemplo:
//
// window.PF_FIREBASE_CONFIG = {
//   apiKey: "AIza...",
//   authDomain: "tu-proyecto.firebaseapp.com",
//   projectId: "tu-proyecto",
//   storageBucket: "tu-proyecto.firebasestorage.app",
//   messagingSenderId: "000000000000",
//   appId: "1:000000000000:web:xxxxxxxxxxxx",
// };
// window.PF_ADMIN_UID = "UID_DEL_ADMINISTRADOR";

window.PF_FIREBASE_CONFIG = null;
window.PF_ADMIN_UID = "";
