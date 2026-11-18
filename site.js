// =========================================================
// PINO FACU · Comportamiento compartido (menú móvil y año)
// =========================================================

(() => {
  const menuButton = document.querySelector(".pf-menu");
  const links = document.querySelector(".pf-links");

  if (menuButton && links) {
    const setOpen = (open) => {
      links.classList.toggle("is-open", open);
      menuButton.setAttribute("aria-expanded", String(open));
      menuButton.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
      menuButton.textContent = open ? "✕" : "☰";
    };

    menuButton.addEventListener("click", () => {
      setOpen(!links.classList.contains("is-open"));
    });

    // Al tocar un enlace del menú móvil, se cierra.
    links.addEventListener("click", (event) => {
      if (event.target.closest("a")) setOpen(false);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && links.classList.contains("is-open")) {
        setOpen(false);
        menuButton.focus();
      }
    });
  }

  document.querySelectorAll("[data-year]").forEach((element) => {
    element.textContent = new Date().getFullYear();
  });
})();
