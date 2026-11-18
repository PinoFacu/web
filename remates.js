// =========================================================
// PINO FACU · Remates (página pública)
// Lee los remates de remates/remates.json, que se edita
// desde admin-remates.html y se guarda en GitHub.
// =========================================================

const WHATSAPP_NUMBER = "542216013657";
const DATA_URL = "remates/remates.json";
const MAX_PHOTOS = 5;

const BADGES = {
  active: "REMATE ACTIVO",
  closed: "REMATE CERRADO",
};

const $ = (id) => document.getElementById(id);

const money = (n) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(n);

/** Devuelve un remate con la forma esperada, o null si los datos no sirven. */
function normalize(raw) {
  if (!raw || typeof raw !== "object") return null;

  const base = Number(raw.base);
  const name = String(raw.name || "").trim();
  if (!name || !Number.isSafeInteger(base) || base <= 0) return null;

  return {
    id: String(raw.id || name),
    name,
    description: String(raw.description || "").trim(),
    base,
    status: ["active", "closed", "hidden"].includes(raw.status) ? raw.status : "hidden",
    photos: Array.isArray(raw.photos) ? raw.photos.filter((p) => typeof p === "string" && p).slice(0, MAX_PHOTOS) : [],
  };
}

async function loadAuctions() {
  // El parámetro ?t= evita que el navegador muestre una versión vieja.
  const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const data = await response.json();
  const items = (Array.isArray(data.items) ? data.items : []).map(normalize).filter(Boolean);

  // Primero los activos, después los cerrados. Los ocultos no se muestran.
  return [...items.filter((item) => item.status === "active"), ...items.filter((item) => item.status === "closed")];
}

/* ---------- Galería ---------- */

function setupGallery(card, item) {
  const image = card.querySelector(".rem-image");
  const thumbs = card.querySelector(".rem-thumbs");
  const pics = item.photos;

  if (!pics.length) {
    card.querySelector(".rem-photo").classList.add("is-empty");
    image.hidden = true;
    return;
  }

  const show = (index) => {
    image.src = pics[index];
    image.alt = pics.length > 1 ? `${item.name} · foto ${index + 1} de ${pics.length}` : item.name;
    thumbs.querySelectorAll("button").forEach((button, j) => {
      button.classList.toggle("active", j === index);
      button.setAttribute("aria-pressed", String(j === index));
    });
  };

  thumbs.hidden = pics.length < 2;

  pics.forEach((src, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", `Ver foto ${index + 1} de ${item.name}`);

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

/* ---------- Oferta ---------- */

function setupOffer(card, item) {
  const input = card.querySelector(".rem-offer");
  const send = card.querySelector(".rem-send");
  const message = card.querySelector(".rem-message");
  const label = card.querySelector(".rem-offer-label");

  const inputId = `oferta-${item.id}`;
  input.id = inputId;
  label.htmlFor = inputId;
  input.min = item.base;
  input.value = item.base + 5000;

  const validate = () => {
    const raw = input.value.trim();
    const amount = Number(raw);
    let error = "";

    if (!raw) error = "Ingresá cuánto ofrecés.";
    else if (!Number.isSafeInteger(amount)) error = "Ingresá un importe en pesos, sin centavos.";
    else if (amount < item.base) error = `La oferta mínima es ${money(item.base)}.`;

    const valid = !error;
    send.setAttribute("aria-disabled", String(!valid));
    input.setAttribute("aria-invalid", String(!valid && Boolean(raw)));
    message.dataset.tone = valid ? "ok" : "error";

    if (valid) {
      const text =
        `¡Hola, Pino Facu! Quiero hacer una oferta por el remate de ${item.name}. ` +
        `Precio base: ${money(item.base)}. Mi oferta: ${money(amount)}. ¿Podemos coordinar?`;
      send.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
      message.textContent = `Vas a enviar una oferta de ${money(amount)}.`;
    } else {
      send.removeAttribute("href");
      message.textContent = error;
    }
  };

  input.addEventListener("input", validate);

  send.addEventListener("click", (event) => {
    if (send.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
      validate();
      input.focus();
    }
  });

  card.querySelectorAll("[data-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = Number(input.value);
      const start = Number.isSafeInteger(value) && value >= item.base ? value : item.base;
      input.value = start + Number(button.dataset.add);
      validate();
    });
  });

  validate();
}

/* ---------- Tarjeta ---------- */

function renderItem(item) {
  const card = $("rem-item-template").content.firstElementChild.cloneNode(true);
  const closed = item.status === "closed";

  card.id = `remate-${item.id}`;
  card.classList.toggle("is-closed", closed);

  const badge = card.querySelector(".rem-badge");
  badge.textContent = BADGES[item.status];
  badge.dataset.status = item.status;

  card.querySelector(".rem-name").textContent = item.name;
  card.querySelector(".rem-base").textContent = money(item.base);

  const description = card.querySelector(".rem-desc");
  description.textContent = item.description;
  description.hidden = !item.description;

  card.querySelector(".rem-form").hidden = closed;
  card.querySelector(".rem-notice").hidden = !closed;

  setupGallery(card, item);
  if (!closed) setupOffer(card, item);

  return card;
}

function showEmpty(title, text) {
  $("rem-empty-title").textContent = title;
  $("rem-empty-text").textContent = text;
  $("rem-empty").hidden = false;
  $("rem-list").hidden = true;
}

async function init() {
  const list = $("rem-list");

  try {
    const items = await loadAuctions();

    if (!items.length) {
      showEmpty(
        "Estamos preparando los próximos remates.",
        "Seguinos en Instagram para enterarte apenas se publiquen.",
      );
      return;
    }

    list.replaceChildren(...items.map(renderItem));
  } catch (error) {
    console.error(error);
    showEmpty("No pudimos cargar los remates.", "Probá de nuevo en unos minutos o escribinos por WhatsApp.");
  } finally {
    list.setAttribute("aria-busy", "false");
  }
}

init();
