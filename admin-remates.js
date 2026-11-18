// =========================================================
// PINO FACU · Administrador de remates
// Guarda los remates y sus fotos en el repositorio de GitHub
// (PinoFacu/web). Cada cambio es un commit; GitHub Pages
// actualiza la web en 1 o 2 minutos.
// =========================================================

/* ---------- Configuración ---------- */

const GITHUB = {
  owner: "PinoFacu",
  repo: "web",
  branch: "main",
};

const DATA_PATH = "remates/remates.json";
const KEY_PATH = "remates/admin-key.json";
const PHOTO_DIR = "remates/fotos";
const MAX_PHOTOS = 5;
const PBKDF2_ITERATIONS = 600000;
const TOKEN_STORAGE = "pf_admin_token";
const API = "https://api.github.com";
const RAW = `https://raw.githubusercontent.com/${GITHUB.owner}/${GITHUB.repo}/${GITHUB.branch}`;

const STATUS_LABEL = {
  active: "Publicado",
  closed: "Cerrado",
  hidden: "Oculto",
};

/* ---------- Estado ---------- */

const state = {
  token: null,
  keyFile: null, // contenido de admin-key.json (token cifrado)
  items: [],
  editingId: null, // null = remate nuevo
  photos: [], // [{ path, src, blob }] · blob = foto nueva pendiente de subir
  busy: false,
};

/* ---------- Utilidades ---------- */

const $ = (id) => document.getElementById(id);

const money = (n) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);

function say(id, text, tone = "") {
  const element = $(id);
  element.textContent = text;
  element.dataset.tone = tone;
}

function setMode(html, tone = "") {
  const box = $("admin-mode");
  box.innerHTML = html; // solo textos fijos de este archivo
  box.dataset.tone = tone;
}

function show(view) {
  $("login-box").hidden = view !== "login";
  $("setup-box").hidden = view !== "setup";
  $("panel").hidden = view !== "panel";
}

/** Muestra una foto: si es una ruta del repo, la toma directo de GitHub (está al instante). */
function photoURL(path) {
  return /^(https?:|blob:|data:)/.test(path) ? path : `${RAW}/${path}`;
}

const isRepoPhoto = (path) => path.startsWith(`${PHOTO_DIR}/`);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------- Cifrado de la clave de GitHub ---------- */

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const toBase64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function deriveKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptToken(token, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(token));
  return {
    version: 1,
    kdf: "PBKDF2-SHA256",
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(data),
  };
}

async function decryptToken(file, password) {
  const key = await deriveKey(password, fromBase64(file.salt), file.iterations);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(file.iv) }, key, fromBase64(file.data));
  return decoder.decode(plain);
}

/* ---------- GitHub API ---------- */

async function gh(path, { method = "GET", body, raw = false, token = state.token } = {}) {
  const response = await fetch(`${API}/repos/${GITHUB.owner}/${GITHUB.repo}${path}`, {
    method,
    cache: "no-store",
    headers: {
      Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = new Error(`GitHub respondió ${response.status}`);
    error.status = response.status;
    try {
      error.detail = (await response.json()).message;
    } catch {
      /* sin detalle */
    }
    throw error;
  }

  if (response.status === 204) return null;
  return raw ? response.text() : response.json();
}

async function readData(ref = GITHUB.branch) {
  try {
    const text = await gh(`/contents/${DATA_PATH}?ref=${ref}`, { raw: true });
    const data = JSON.parse(text);
    return { ...data, items: Array.isArray(data.items) ? data.items : [] };
  } catch (error) {
    if (error.status === 404) return { items: [] };
    throw error;
  }
}

/**
 * Hace UN commit con todos los cambios:
 * - change(data) modifica remates.json y puede devolver rutas de fotos a borrar.
 * - newFiles: [{ path, base64 }] fotos nuevas.
 * - extraFiles: { ruta: textoCompleto } otros archivos de texto.
 * Si alguien guardó al mismo tiempo, reintenta una vez sobre la versión nueva.
 */
async function commit({ message, change, newFiles = [], extraFiles = {} }) {
  // Las fotos se suben una sola vez como "blobs", antes del commit.
  const blobs = [];
  for (const [index, file] of newFiles.entries()) {
    say("editor-msg", `Subiendo foto ${index + 1} de ${newFiles.length}…`);
    const blob = await gh("/git/blobs", { method: "POST", body: { content: file.base64, encoding: "base64" } });
    blobs.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const ref = await gh(`/git/ref/heads/${GITHUB.branch}`);
    const headSha = ref.object.sha;
    const head = await gh(`/git/commits/${headSha}`);

    const tree = [...blobs];
    let data = null;

    if (change) {
      data = await readData(headSha);
      const toDelete = change(data) || [];
      data.updatedAt = new Date().toISOString();
      tree.push({ path: DATA_PATH, mode: "100644", type: "blob", content: JSON.stringify(data, null, 2) + "\n" });
      toDelete.filter(isRepoPhoto).forEach((path) => tree.push({ path, mode: "100644", type: "blob", sha: null }));
    }

    for (const [path, content] of Object.entries(extraFiles)) {
      tree.push({ path, mode: "100644", type: "blob", content });
    }

    const newTree = await gh("/git/trees", { method: "POST", body: { base_tree: head.tree.sha, tree } });
    const newCommit = await gh("/git/commits", {
      method: "POST",
      body: { message, tree: newTree.sha, parents: [headSha] },
    });

    try {
      await gh(`/git/refs/heads/${GITHUB.branch}`, { method: "PATCH", body: { sha: newCommit.sha, force: false } });
      return data;
    } catch (error) {
      if (error.status === 422 && attempt === 0) continue; // otro cambio entró antes: reintentar
      throw error;
    }
  }
}

function explain(error) {
  console.error(error);
  if (error.status === 401) return "La clave de GitHub venció o fue revocada. Configurá el acceso de nuevo.";
  if (error.status === 403) return "La clave de GitHub no tiene permiso para escribir en el repositorio.";
  if (error.status === 404) return "No se encontró el repositorio. Revisá que la clave tenga acceso a PinoFacu/web.";
  if (error.status === 422) return "GitHub rechazó el cambio. Recargá la página y probá de nuevo.";
  if (error instanceof TypeError) return "Sin conexión con GitHub. Revisá internet y probá de nuevo.";
  return error.message || "Error desconocido.";
}

/* ---------- Acceso ---------- */

async function fetchKeyFile() {
  // Primero desde la web publicada; si todavía no está, directo del repo.
  for (const url of [`${KEY_PATH}?t=${Date.now()}`, `${RAW}/${KEY_PATH}?t=${Date.now()}`]) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return await response.json();
    } catch {
      /* probar la siguiente */
    }
  }
  return null;
}

function rememberToken(token, persistent) {
  sessionStorage.setItem(TOKEN_STORAGE, token);
  if (persistent) localStorage.setItem(TOKEN_STORAGE, token);
}

function forgetToken() {
  sessionStorage.removeItem(TOKEN_STORAGE);
  localStorage.removeItem(TOKEN_STORAGE);
  state.token = null;
}

async function login(event) {
  event.preventDefault();
  const password = $("login-pass").value;
  if (!password) return say("login-msg", "Escribí la contraseña.", "error");

  const button = $("login-button");
  button.disabled = true;
  say("login-msg", "Verificando…");

  try {
    let token;
    try {
      token = await decryptToken(state.keyFile, password);
    } catch {
      say("login-msg", "Contraseña incorrecta.", "error");
      $("login-pass").select();
      return;
    }

    await gh("", { token }); // comprueba que la clave de GitHub siga funcionando
    state.token = token;
    rememberToken(token, $("login-remember").checked);
    $("login-pass").value = "";
    say("login-msg", "");
    await openPanel();
  } catch (error) {
    say("login-msg", explain(error), "error");
  } finally {
    button.disabled = false;
  }
}

async function setup(event) {
  event.preventDefault();
  const token = $("setup-token").value.trim();
  const password = $("setup-pass").value;

  if (!token) return say("setup-msg", "Pegá la clave (token) de GitHub.", "error");
  if (password.length < 8) return say("setup-msg", "La contraseña tiene que tener al menos 8 caracteres.", "error");
  if (password !== $("setup-pass2").value) return say("setup-msg", "Las contraseñas no coinciden.", "error");

  const button = $("setup-button");
  button.disabled = true;

  try {
    say("setup-msg", "Probando la clave de GitHub…");
    await gh("", { token });
    state.token = token;

    say("setup-msg", "Cifrando y guardando…");
    const keyFile = await encryptToken(token, password);
    await commit({
      message: "Admin remates: configurar acceso",
      change: () => [], // crea remates.json si todavía no existe
      extraFiles: { [KEY_PATH]: JSON.stringify(keyFile, null, 2) + "\n" },
    });

    state.keyFile = keyFile;
    rememberToken(token, false);
    $("setup-token").value = $("setup-pass").value = $("setup-pass2").value = "";
    say("setup-msg", "");
    await openPanel();
    say("panel-msg", "✓ Acceso configurado. Desde ahora se entra solo con la contraseña.", "ok");
  } catch (error) {
    state.token = null;
    say("setup-msg", explain(error), "error");
  } finally {
    button.disabled = false;
  }
}

function logout() {
  forgetToken();
  closeEditor();
  setMode("<strong>Sesión cerrada.</strong>");
  show("login");
  $("login-pass").focus();
}

/* ---------- Panel: lista de remates ---------- */

async function openPanel() {
  show("panel");
  setMode("<strong>Conectado.</strong> Los cambios se guardan en GitHub y se ven en la web en 1 o 2 minutos.", "ok");
  say("panel-msg", "Cargando remates…");
  try {
    const data = await readData();
    state.items = data.items;
    renderList();
    say("panel-msg", "");
  } catch (error) {
    if (error.status === 401) {
      forgetToken();
      show("login");
      say("login-msg", explain(error), "error");
      return;
    }
    say("panel-msg", explain(error), "error");
  }
}

function renderList() {
  const list = $("item-list");
  list.replaceChildren();

  if (!state.items.length) {
    const empty = document.createElement("p");
    empty.className = "admin-empty";
    empty.textContent = "Todavía no hay remates. Tocá “+ NUEVO REMATE” para cargar el primero.";
    list.append(empty);
    return;
  }

  state.items.forEach((item, index) => {
    const row = document.createElement("article");
    row.className = "admin-item";
    row.dataset.status = item.status;

    const thumb = document.createElement("div");
    thumb.className = "admin-item-thumb";
    if (item.photos?.[0]) {
      const img = document.createElement("img");
      img.src = photoURL(item.photos[0]);
      img.alt = "";
      img.loading = "lazy";
      thumb.append(img);
    } else {
      thumb.textContent = "📷";
    }

    const info = document.createElement("div");
    info.className = "admin-item-info";
    const name = document.createElement("strong");
    name.textContent = item.name;
    const meta = document.createElement("span");
    meta.textContent = `${money(item.base)} · ${item.photos?.length || 0} foto(s)`;
    const chip = document.createElement("span");
    chip.className = "admin-chip";
    chip.dataset.status = item.status;
    chip.textContent = STATUS_LABEL[item.status] || item.status;
    info.append(chip, name, meta);

    const actions = document.createElement("div");
    actions.className = "admin-item-actions";

    const button = (text, className, handler, label) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = className;
      b.textContent = text;
      if (label) b.setAttribute("aria-label", label);
      b.addEventListener("click", handler);
      actions.append(b);
    };

    if (index > 0) button("↑", "admin-mini", () => move(item.id, -1), `Subir ${item.name}`);
    button("EDITAR", "admin-mini", () => openEditor(item));
    button(item.status === "hidden" ? "MOSTRAR" : "OCULTAR", "admin-mini", () =>
      setStatus(item, item.status === "hidden" ? "active" : "hidden"),
    );
    button("ELIMINAR", "admin-mini danger", () => removeItem(item));

    row.append(thumb, info, actions);
    list.append(row);
  });
}

async function runPanelAction(text, action) {
  if (state.busy) return;
  state.busy = true;
  document.body.classList.add("is-busy");
  say("panel-msg", text);
  try {
    const data = await action();
    if (data) state.items = data.items;
    renderList();
    say("panel-msg", "✓ Listo. La web se actualiza en 1 o 2 minutos.", "ok");
  } catch (error) {
    say("panel-msg", explain(error), "error");
  } finally {
    state.busy = false;
    document.body.classList.remove("is-busy");
  }
}

function setStatus(item, status) {
  runPanelAction(status === "hidden" ? "Ocultando…" : "Publicando…", () =>
    commit({
      message: `Remates: ${status === "hidden" ? "ocultar" : "mostrar"} "${item.name}"`,
      change: (data) => {
        const found = data.items.find((x) => x.id === item.id);
        if (found) found.status = status;
      },
    }),
  );
}

function move(id, delta) {
  runPanelAction("Reordenando…", () =>
    commit({
      message: "Remates: cambiar el orden",
      change: (data) => {
        const index = data.items.findIndex((x) => x.id === id);
        const target = index + delta;
        if (index < 0 || target < 0 || target >= data.items.length) return;
        const [moved] = data.items.splice(index, 1);
        data.items.splice(target, 0, moved);
      },
    }),
  );
}

function removeItem(item) {
  const ok = confirm(`¿Eliminar "${item.name}"?\n\nSe saca de la web y se borran sus fotos. No se puede deshacer.`);
  if (!ok) return;

  if (state.editingId === item.id) closeEditor();

  runPanelAction("Eliminando…", () =>
    commit({
      message: `Remates: eliminar "${item.name}"`,
      change: (data) => {
        const index = data.items.findIndex((x) => x.id === item.id);
        if (index < 0) return [];
        const [removed] = data.items.splice(index, 1);
        return removed.photos || [];
      },
    }),
  );
}

/* ---------- Editor ---------- */

function updateHints() {
  const base = Number($("admin-base").value);
  $("admin-base-hint").textContent =
    Number.isSafeInteger(base) && base > 0
      ? `Se muestra como ${money(base)}`
      : "Número entero, sin puntos ni centavos.";
  $("admin-desc-count").textContent = $("admin-desc").value.length;
}

function openEditor(item = null) {
  revokePreviews();
  state.editingId = item?.id || null;
  state.photos = (item?.photos || []).map((path) => ({ path, src: photoURL(path), blob: null }));

  $("editor-title").textContent = item ? `Editar: ${item.name}` : "Nuevo remate";
  $("admin-name").value = item?.name || "";
  $("admin-desc").value = item?.description || "";
  $("admin-base").value = item?.base || "";
  $("admin-state").value = item?.status || "active";
  ["admin-name", "admin-base"].forEach((id) => $(id).removeAttribute("aria-invalid"));

  say("editor-msg", "");
  updateHints();
  renderPreview();

  $("editor").hidden = false;
  $("editor").scrollIntoView({ behavior: "smooth", block: "start" });
  $("admin-name").focus({ preventScroll: true });
}

function closeEditor() {
  revokePreviews();
  state.photos = [];
  state.editingId = null;
  $("editor").hidden = true;
}

function revokePreviews() {
  state.photos.forEach((photo) => {
    if (photo.src.startsWith("blob:")) URL.revokeObjectURL(photo.src);
  });
}

function renderPreview() {
  const box = $("admin-preview");
  box.replaceChildren();

  state.photos.forEach((photo, index) => {
    const figure = document.createElement("figure");
    figure.className = "admin-photo";

    const img = document.createElement("img");
    img.src = photo.src;
    img.alt = `Foto ${index + 1} del mueble`;

    const caption = document.createElement("figcaption");
    caption.textContent = index === 0 ? "Portada" : `Foto ${index + 1}`;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Quitar foto ${index + 1}`);
    remove.addEventListener("click", () => {
      const [removed] = state.photos.splice(index, 1);
      if (removed.src.startsWith("blob:")) URL.revokeObjectURL(removed.src);
      renderPreview();
    });

    figure.append(img, caption, remove);

    if (index > 0) {
      const first = document.createElement("button");
      first.type = "button";
      first.className = "admin-photo-cover";
      first.textContent = "★";
      first.title = "Usar como portada";
      first.setAttribute("aria-label", `Usar foto ${index + 1} como portada`);
      first.addEventListener("click", () => {
        const [moved] = state.photos.splice(index, 1);
        state.photos.unshift(moved);
        renderPreview();
      });
      figure.append(first);
    }

    box.append(figure);
  });

  $("admin-drop").hidden = state.photos.length >= MAX_PHOTOS;
}

/** Achica la imagen (lado mayor = maxSide) y la pasa a WebP, conservando transparencias. */
function compressImage(file, maxSide = 1600) {
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
        0.82,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer la imagen."));
    };

    img.src = url;
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(blob);
  });
}

async function addPhotos(fileList) {
  const files = [...fileList].filter((file) => file.type.startsWith("image/"));
  if (!files.length) return say("editor-msg", "Elegí archivos de imagen (JPG, PNG, WebP…).", "error");

  const free = MAX_PHOTOS - state.photos.length;
  if (free <= 0) return say("editor-msg", `Ya hay ${MAX_PHOTOS} fotos. Quitá alguna para sumar otra.`, "error");

  say("editor-msg", "Preparando fotos…");
  try {
    for (const file of files.slice(0, free)) {
      const compressed = await compressImage(file).catch(() => null);
      const blob = compressed && compressed.size < file.size ? compressed : file;
      if (blob.size > 8 * 1024 * 1024) throw new Error(`"${file.name}" es demasiado pesada. Probá con otra foto.`);
      state.photos.push({ path: null, src: URL.createObjectURL(blob), blob });
    }
    renderPreview();
    const skipped = files.length - free;
    say(
      "editor-msg",
      skipped > 0
        ? `Se agregaron ${free}; ${skipped} quedaron afuera (máximo ${MAX_PHOTOS}).`
        : "Fotos listas. Se suben al guardar.",
    );
  } catch (error) {
    renderPreview();
    say("editor-msg", error.message, "error");
  }
}

function extensionFor(type) {
  return { "image/webp": "webp", "image/png": "png", "image/gif": "gif" }[type] || "jpg";
}

async function saveItem(event) {
  event.preventDefault();
  if (state.busy) return;

  const name = $("admin-name").value.trim();
  const description = $("admin-desc").value.trim();
  const base = Number($("admin-base").value);
  const status = $("admin-state").value;

  const validBase = Number.isSafeInteger(base) && base > 0;
  $("admin-name").setAttribute("aria-invalid", String(!name));
  $("admin-base").setAttribute("aria-invalid", String(!validBase));
  if (!name) return say("editor-msg", "Completá el nombre del mueble.", "error");
  if (!validBase) return say("editor-msg", "El precio base tiene que ser un número entero mayor que cero.", "error");

  const id = state.editingId || newId();
  const stamp = Date.now().toString(36);

  state.busy = true;
  $("admin-save").disabled = true;
  $("admin-save").textContent = "GUARDANDO…";
  say("editor-msg", "Guardando…");

  try {
    // Las fotos nuevas reciben su ruta definitiva en el repo.
    const newFiles = [];
    const photoPaths = [];
    for (const [index, photo] of state.photos.entries()) {
      if (photo.blob) {
        const type = photo.blob.type || "image/jpeg";
        const path = `${PHOTO_DIR}/${id}-${stamp}-${index + 1}.${extensionFor(type)}`;
        newFiles.push({ path, base64: await blobToBase64(photo.blob) });
        photoPaths.push(path);
      } else {
        photoPaths.push(photo.path);
      }
    }

    const verb = state.editingId ? "editar" : "agregar";
    const data = await commit({
      message: `Remates: ${verb} "${name}"`,
      newFiles,
      change: (data) => {
        const existing = data.items.find((x) => x.id === id);
        const record = { id, name, description, base, status, photos: photoPaths };

        if (existing) {
          const removed = (existing.photos || []).filter((path) => !photoPaths.includes(path));
          Object.assign(existing, record, { updatedAt: new Date().toISOString() });
          return removed; // fotos que se sacaron: se borran del repo
        }

        data.items.unshift({ ...record, createdAt: new Date().toISOString() });
        return [];
      },
    });

    state.items = data.items;
    closeEditor();
    renderList();
    const where = status === "hidden" ? "Quedó oculto." : "La web se actualiza en 1 o 2 minutos.";
    say("panel-msg", `✓ "${name}" guardado. ${where}`, "ok");
  } catch (error) {
    say("editor-msg", explain(error), "error");
  } finally {
    state.busy = false;
    $("admin-save").disabled = false;
    $("admin-save").textContent = "GUARDAR REMATE";
  }
}

/* ---------- Eventos ---------- */

function bindEvents() {
  $("login-box").addEventListener("submit", login);
  $("setup-box").addEventListener("submit", setup);
  $("go-setup").addEventListener("click", () => {
    $("setup-cancel").hidden = false;
    show("setup");
    $("setup-token").focus();
  });
  $("setup-cancel").addEventListener("click", () => show("login"));
  $("logout").addEventListener("click", logout);

  $("new-item").addEventListener("click", () => openEditor());
  $("editor").addEventListener("submit", saveItem);
  $("editor-cancel").addEventListener("click", closeEditor);
  $("admin-base").addEventListener("input", updateHints);
  $("admin-desc").addEventListener("input", updateHints);

  const fileInput = $("admin-photos");
  const drop = $("admin-drop");

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

  // Aviso si se quiere cerrar la pestaña con un remate a medio guardar.
  window.addEventListener("beforeunload", (event) => {
    if (state.busy) event.preventDefault();
  });
}

/* ---------- Arranque ---------- */

async function init() {
  bindEvents();

  if (!window.crypto?.subtle) {
    setMode("<strong>Esta página necesita abrirse con https://</strong> (por ejemplo, https://pinofacu.com).", "error");
    return;
  }

  state.keyFile = await fetchKeyFile();

  if (!state.keyFile) {
    setMode("<strong>Primera vez:</strong> configurá el acceso para poder guardar remates en GitHub.");
    show("setup");
    return;
  }

  // ¿Ya había una sesión abierta en este dispositivo?
  const saved = sessionStorage.getItem(TOKEN_STORAGE) || localStorage.getItem(TOKEN_STORAGE);
  if (saved) {
    state.token = saved;
    await openPanel();
    return;
  }

  setMode("<strong>Área interna.</strong> Ingresá la contraseña para administrar los remates.");
  show("login");
  $("login-pass").focus();
}

init();
