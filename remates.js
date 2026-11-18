// =========================================================
// PINO FACU · Remates
// Un solo archivo para la página pública (remates.html)
// y el administrador (admin-remates.html).
// =========================================================

/* ---------- Constantes ---------- */

const WHATSAPP_NUMBER = "542216013657";
const FIREBASE_VERSION = "11.10.0";
const DEMO_STORAGE_KEY = "pf_remate_demo";
const MAX_PHOTOS = 5;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // igual que storage.rules
const STATUSES = ["draft", "active", "closed"];

const DEMO = {
  name: "Ropero de pino · 3 puertas",
  description: "Una unidad de ejemplo para conocer cómo funcionan los remates.",
  base: 100000,
  status: "demo",
  photos: ["https://raw.githubusercontent.com/PinoFacu/mayorista/refs/heads/main/RoperoDePino-3Puertas-2.png"],
};

const STATUS_COPY = {
  active: { badge: "REMATE ACTIVO" },
  closed: {
    badge: "REMATE CERRADO",
    title: "Este remate está cerrado.",
    text: "Seguí nuestras redes para enterarte del próximo.",
  },
  draft: {
    badge: "PRÓXIMAMENTE",
    title: "Estamos preparando el próximo remate.",
    text: "Seguinos en Instagram para enterarte apenas se publique.",
  },
  demo: { badge: "EJEMPLO INTERACTIVO" },
};

/* ---------- Utilidades ---------- */

const $ = (id) => document.getElementById(id);

const money = (n) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(n);

const configured = Boolean(window.PF_FIREBASE_CONFIG?.apiKey && window.PF_ADMIN_UID);
const isAdminPage = Boolean($("admin-editor"));

let fb = null; // módulos e instancias de Firebase
let current = DEMO; // remate que se está mostrando

/** Deja los datos del remate con la forma esperada, venga de donde venga. */
function normalizeAuction(data) {
  if (!data || typeof data !== "object") return { ...DEMO };

  const base = Number(data.base);
  const status = [...STATUSES, "demo"].includes(data.status) ? data.status : "draft";

  return {
    name: String(data.name || "").trim() || DEMO.name,
    description: String(data.description || "").trim(),
    base: Number.isSafeInteger(base) && base > 0 ? base : DEMO.base,
    status,
    photos: Array.isArray(data.photos)
      ? data.photos.filter((url) => typeof url === "string" && url).slice(0, MAX_PHOTOS)
      : [],
  };
}

function readDemo() {
  try {
    const saved = JSON.parse(localStorage.getItem(DEMO_STORAGE_KEY));
    return saved ? normalizeAuction(saved) : { ...DEMO };
  } catch {
    return { ...DEMO };
  }
}

/* ---------- Firebase (se carga solo si está configurado) ---------- */

async function initFirebase({ withAuth = false, withStorage = false } = {}) {
  if (fb) return fb;

  const cdn = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const [appModule, firestore, auth, storage] = await Promise.all([
    import(`${cdn}/firebase-app.js`),
    import(`${cdn}/firebase-firestore.js`),
    withAuth ? import(`${cdn}/firebase-auth.js`) : null,
    withStorage ? import(`${cdn}/firebase-storage.js`) : null,
  ]);

  const app = appModule.initializeApp(window.PF_FIREBASE_CONFIG);
  fb = { firestore, db: firestore.getFirestore(app) };

  if (auth) {
    fb.authApi = auth;
    fb.auth = auth.getAuth(app);
  }
  if (storage) {
    fb.storageApi = storage;
    fb.storage = storage.getStorage(app);
  }
  return fb;
}

const auctionDoc = () => fb.firestore.doc(fb.db, "remates", "actual");

/* =========================================================
   PÁGINA PÚBLICA
   ========================================================= */

function renderAuction(raw) {
  const data = normalizeAuction(raw);
  current = data;

  const { status } = data;
  const canOffer = status === "active";
  const showNotice = status === "closed" || status === "draft";
  const copy = STATUS_COPY[status];

  // Un borrador nunca muestra su contenido en la página pública.
  const name = status === "draft" ? "Próximo remate" : data.name;
  const description = status === "draft" ? "Muy pronto vas a poder ofertar por un nuevo mueble." : data.description;
  const photos = status === "draft" ? DEMO.photos : data.photos;

  $("rem-badge").textContent = copy.badge;
  $("rem-badge").dataset.status = status;
  $("rem-name").textContent = name;
  $("rem-desc").textContent = description;
  $("rem-desc").hidden = !description;
  $("rem-base").textContent = money(data.base);
  $("rem-price").hidden = status === "draft";

  $("rem-form").hidden = showNotice;
  $("rem-notice").hidden = !showNotice;
  if (showNotice) {
    $("rem-notice-title").textContent = copy.title;
    $("rem-notice-text").textContent = copy.text;
  }
  $("rem-demo-note").hidden = status !== "demo";

  const offer = $("rem-offer");
  offer.min = data.base;
  offer.value = data.base + 5000;

  renderGallery(photos, name);
  $("rem-panel").setAttribute("aria-busy", "false");
  validateOffer();

  if (canOffer) document.title = `${data.name} · Remates | Pino Facu`;
}

function renderGallery(photos, name) {
  const pics = photos.length ? photos : DEMO.photos;
  const image = $("rem-image");
  const thumbs = $("rem-thumbs");

  const show = (index) => {
    image.src = pics[index];
    image.alt = pics.length > 1 ? `${name} · foto ${index + 1} de ${pics.length}` : name;
    thumbs.querySelectorAll("button").forEach((button, j) => {
      button.classList.toggle("active", j === index);
      button.setAttribute("aria-pressed", String(j === index));
    });
  };

  thumbs.replaceChildren();
  thumbs.hidden = pics.length < 2;

  pics.forEach((src, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", `Ver foto ${index + 1}`);

    const thumb = document.createElement("img");
    thumb.src = src;
    thumb.alt = "";
    thumb.loading = "lazy";

    button.append(thumb);
    button.addEventListener("click", () => show(index));
    thumbs.append(button);
  });

  show(0);
}

function setOfferMessage(text, tone = "") {
  const message = $("rem-error");
  message.textContent = text;
  message.dataset.tone = tone;
}

function validateOffer() {
  const input = $("rem-offer");
  const send = $("rem-send");
  if (!input || !send) return false;

  const raw = input.value.trim();
  const amount = Number(raw);
  let error = "";

  if (current.status === "demo") {
    setOfferMessage("Es un ejemplo: el envío se habilita cuando haya un remate publicado.", "info");
    send.setAttribute("aria-disabled", "true");
    send.removeAttribute("href");
    return false;
  }

  if (current.status !== "active") error = "Este remate no está recibiendo ofertas.";
  else if (!raw) error = "Ingresá cuánto ofrecés.";
  else if (!Number.isSafeInteger(amount)) error = "Ingresá un importe en pesos, sin centavos.";
  else if (amount < current.base) error = `La oferta mínima es ${money(current.base)}.`;

  const valid = !error;
  send.setAttribute("aria-disabled", String(!valid));
  input.setAttribute("aria-invalid", String(!valid && Boolean(raw)));

  if (valid) {
    const text =
      `¡Hola, Pino Facu! Quiero hacer una oferta por el remate de ${current.name}. ` +
      `Precio base: ${money(current.base)}. Mi oferta: ${money(amount)}. ¿Podemos coordinar?`;
    send.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
    setOfferMessage(`Vas a enviar una oferta de ${money(amount)}.`, "ok");
  } else {
    send.removeAttribute("href");
    setOfferMessage(error, "error");
  }
  return valid;
}

async function publicInit() {
  const offer = $("rem-offer");
  const send = $("rem-send");

  offer.addEventListener("input", validateOffer);

  send.addEventListener("click", (event) => {
    if (send.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
      validateOffer();
      offer.focus();
    }
  });

  document.querySelectorAll("[data-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = Number(offer.value);
      const start = Number.isSafeInteger(value) && value >= current.base ? value : current.base;
      offer.value = start + Number(button.dataset.add);
      validateOffer();
    });
  });

  if (!configured) {
    renderAuction(readDemo());
    return;
  }

  try {
    await initFirebase();
    const snap = await fb.firestore.getDoc(auctionDoc());
    renderAuction(snap.exists() ? snap.data() : { status: "draft" });
  } catch (error) {
    // Las reglas niegan la lectura de borradores: se muestra "próximamente".
    if (error?.code === "permission-denied") {
      renderAuction({ status: "draft" });
      return;
    }
    console.error(error);
    renderAuction(DEMO);
    setOfferMessage("No pudimos cargar el remate publicado. Probá de nuevo en unos minutos.", "error");
  }
}

/* =========================================================
   ADMINISTRADOR
   ========================================================= */

let currentUser = null;
let photoItems = []; // [{ src, blob }] · blob = foto nueva pendiente de subir

function setMode(html, tone = "") {
  const box = $("admin-mode");
  box.innerHTML = html; // solo se usan textos fijos de este archivo
  box.dataset.tone = tone;
}

function setMessage(text, tone = "") {
  const message = $("admin-message");
  message.textContent = text;
  message.dataset.tone = tone;
}

function setBusy(busy) {
  const save = $("admin-save");
  save.disabled = busy;
  save.textContent = busy ? "GUARDANDO…" : "GUARDAR REMATE";
}

function updateHints() {
  const base = Number($("admin-base").value);
  $("admin-base-hint").textContent =
    Number.isSafeInteger(base) && base > 0
      ? `Se muestra como ${money(base)}`
      : "Número entero, sin puntos ni centavos.";
  $("admin-desc-count").textContent = $("admin-desc").value.length;
}

function populate(raw) {
  const data = normalizeAuction(raw);
  $("admin-name").value = data.name;
  $("admin-desc").value = data.description;
  $("admin-base").value = data.base;
  $("admin-state").value = data.status === "demo" ? "draft" : data.status;

  revokePreviews();
  photoItems = data.photos.map((src) => ({ src, blob: null }));
  renderPreview();
  updateHints();
}

function revokePreviews() {
  photoItems.forEach((item) => {
    if (item.src.startsWith("blob:")) URL.revokeObjectURL(item.src);
  });
}

function renderPreview() {
  const box = $("admin-preview");
  box.replaceChildren();

  photoItems.forEach((item, index) => {
    const figure = document.createElement("figure");
    figure.className = "admin-photo";

    const img = document.createElement("img");
    img.src = item.src;
    img.alt = `Foto ${index + 1} del mueble`;

    const caption = document.createElement("figcaption");
    caption.textContent = index === 0 ? "Portada" : `Foto ${index + 1}`;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Quitar foto ${index + 1}`);
    remove.addEventListener("click", () => {
      const [removed] = photoItems.splice(index, 1);
      if (removed.src.startsWith("blob:")) URL.revokeObjectURL(removed.src);
      renderPreview();
      setMessage("Foto quitada. Guardá para aplicar el cambio.");
    });

    figure.append(img, caption, remove);
    box.append(figure);
  });

  $("admin-drop").hidden = photoItems.length >= MAX_PHOTOS;
}

/** Achica la imagen (lado mayor = maxSide) y la pasa a WebP manteniendo transparencias. */
function compressImage(file, maxSide) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("No se pudo procesar la imagen."))),
        "image/webp",
        0.85,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la imagen."));
    };

    img.src = url;
  });
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(blob);
  });
}

async function preparePhoto(file) {
  if (!file.type.startsWith("image/")) throw new Error(`"${file.name}" no es una imagen.`);

  // En demo se achica más porque el navegador guarda poco espacio (≈5 MB en total).
  const compressed = await compressImage(file, configured ? 1600 : 1000).catch(() => null);
  const blob = compressed && compressed.size < file.size ? compressed : file;

  if (blob.size > MAX_UPLOAD_BYTES) throw new Error(`"${file.name}" pesa más de 4 MB. Probá con otra foto.`);

  const src = configured ? URL.createObjectURL(blob) : await blobToDataURL(blob);
  return { src, blob };
}

async function addPhotos(fileList) {
  const files = [...fileList];
  if (!files.length) return;

  const free = MAX_PHOTOS - photoItems.length;
  if (free <= 0) {
    setMessage(`Ya hay ${MAX_PHOTOS} fotos. Quitá alguna para sumar otra.`, "error");
    return;
  }

  try {
    setMessage("Preparando fotos…");
    for (const file of files.slice(0, free)) {
      photoItems.push(await preparePhoto(file));
    }
    renderPreview();

    const skipped = files.length - free;
    const note = configured ? " Se suben al guardar." : "";
    setMessage(
      skipped > 0
        ? `Se agregaron ${free} foto(s); ${skipped} quedaron afuera por el máximo de ${MAX_PHOTOS}.${note}`
        : `Foto(s) agregada(s).${note}`,
    );
  } catch (error) {
    renderPreview();
    setMessage(error.message, "error");
  }
}

function extensionFor(type) {
  return { "image/webp": "webp", "image/png": "png", "image/gif": "gif" }[type] || "jpg";
}

async function uploadPendingPhotos() {
  const urls = [];
  for (const [index, item] of photoItems.entries()) {
    if (!item.blob) {
      urls.push(item.src);
      continue;
    }
    setMessage(`Subiendo foto ${index + 1} de ${photoItems.length}…`);
    const type = item.blob.type || "image/jpeg";
    const path = `remates/actual/${Date.now()}-${index}.${extensionFor(type)}`;
    const ref = fb.storageApi.ref(fb.storage, path);
    await fb.storageApi.uploadBytes(ref, item.blob, { contentType: type });
    urls.push(await fb.storageApi.getDownloadURL(ref));
  }
  return urls;
}

function readForm() {
  const name = $("admin-name").value.trim();
  const description = $("admin-desc").value.trim();
  const base = Number($("admin-base").value);
  const status = $("admin-state").value;

  $("admin-name").setAttribute("aria-invalid", String(!name));
  $("admin-base").setAttribute("aria-invalid", String(!(Number.isSafeInteger(base) && base > 0)));

  if (!name) throw new Error("Completá el nombre del mueble.");
  if (!Number.isSafeInteger(base) || base <= 0)
    throw new Error("El precio base tiene que ser un número entero mayor que cero.");
  if (!STATUSES.includes(status)) throw new Error("Elegí un estado válido.");

  return { name, description, base, status };
}

async function saveAuction(event) {
  event.preventDefault();

  let fields;
  try {
    if (configured && !currentUser) throw new Error("Iniciá sesión como administrador.");
    fields = readForm();
  } catch (error) {
    setMessage(error.message, "error");
    return;
  }

  setBusy(true);
  setMessage("Guardando…");

  try {
    const photos = configured ? await uploadPendingPhotos() : photoItems.map((item) => item.src);
    const item = { ...fields, photos, updatedAt: Date.now() };

    if (configured) {
      await fb.firestore.setDoc(auctionDoc(), item);
    } else {
      localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(item));
    }

    revokePreviews();
    photoItems = photos.map((src) => ({ src, blob: null }));
    renderPreview();

    const where = configured ? "" : " (visible solo en este navegador)";
    const what = {
      active: "Remate publicado",
      draft: "Guardado como borrador",
      closed: "Remate guardado como cerrado",
    }[fields.status];
    setMessage(`✓ ${what}${where}.`, "ok");
  } catch (error) {
    console.error(error);
    const text =
      error?.name === "QuotaExceededError"
        ? "Las fotos ocupan demasiado para el modo demo. Usá menos fotos o más livianas."
        : error?.code === "permission-denied"
          ? "Firebase rechazó el guardado. Revisá el UID en las reglas publicadas."
          : `No se pudo guardar: ${error.message || "error desconocido"}.`;
    setMessage(text, "error");
  } finally {
    setBusy(false);
  }
}

function bindAdminEvents() {
  const fileInput = $("admin-photos");
  const drop = $("admin-drop");

  $("admin-editor").addEventListener("submit", saveAuction);
  $("admin-base").addEventListener("input", updateHints);
  $("admin-desc").addEventListener("input", updateHints);

  fileInput.addEventListener("change", async () => {
    await addPhotos(fileInput.files);
    fileInput.value = ""; // permite volver a elegir la misma foto
  });

  ["dragenter", "dragover"].forEach((type) =>
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.add("is-over");
    }),
  );
  ["dragleave", "drop"].forEach((type) => drop.addEventListener(type, () => drop.classList.remove("is-over")));
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    addPhotos(event.dataTransfer.files);
  });
}

async function adminInit() {
  bindAdminEvents();

  if (!configured) {
    setMode(
      "<strong>MODO DEMOSTRACIÓN LOCAL.</strong> Podés cargar fotos, precio y estado, pero los cambios solo se ven " +
        "en este navegador. Para publicar remates reales hay que configurar Firebase (ver LEEME.txt).",
    );
    $("admin-editor").hidden = false;
    populate(readDemo());
    return;
  }

  setMode("Conectando con Firebase…");

  try {
    await initFirebase({ withAuth: true, withStorage: true });
  } catch (error) {
    console.error(error);
    setMode("<strong>No se pudo conectar a Firebase.</strong> Revisá los datos de firebase-config.js.", "error");
    return;
  }

  setMode("<strong>Modo conectado.</strong> Solo el usuario administrador autorizado puede publicar remates.", "ok");

  const { authApi, auth } = fb;
  const loginBox = $("admin-login-box");
  const loginStatus = $("admin-login-status");

  authApi.onAuthStateChanged(auth, async (user) => {
    if (user && user.uid !== window.PF_ADMIN_UID) {
      loginStatus.textContent = "Esta cuenta no tiene permisos de administración.";
      await authApi.signOut(auth);
      return;
    }

    currentUser = user || null;
    $("admin-editor").hidden = !currentUser;
    loginBox.hidden = Boolean(currentUser);
    $("admin-logout").hidden = !currentUser;

    if (!currentUser) return;

    loginStatus.textContent = "";
    try {
      const snap = await fb.firestore.getDoc(auctionDoc());
      populate(snap.exists() ? snap.data() : { ...DEMO, status: "draft" });
      setMessage("");
    } catch (error) {
      console.error(error);
      setMessage("No se pudo leer el remate actual.", "error");
    }
  });

  loginBox.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("admin-login");
    button.disabled = true;
    loginStatus.textContent = "Ingresando…";

    try {
      await authApi.signInWithEmailAndPassword(auth, $("admin-email").value.trim(), $("admin-password").value);
      $("admin-password").value = "";
    } catch (error) {
      console.error(error);
      loginStatus.textContent = "No se pudo iniciar sesión. Revisá el correo y la contraseña.";
    } finally {
      button.disabled = false;
    }
  });

  $("admin-logout").addEventListener("click", () => authApi.signOut(auth));
}

/* ---------- Arranque ---------- */

if (isAdminPage) adminInit();
else if ($("rem-offer")) publicInit();
