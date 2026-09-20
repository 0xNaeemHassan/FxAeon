const THEME_KEY = "fxaeon-theme";

const readTheme = () => {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "dark";
  } catch {
    return "dark";
  }
};

const applyTheme = (theme, persist = false) => {
  const next = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  if (persist) {
    try { window.localStorage.setItem(THEME_KEY, next); } catch { /* storage can be unavailable */ }
  }
};

// This file is loaded before the stylesheet so the saved theme is applied before first paint.
applyTheme(readTheme());

const init = () => {
  const year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();

  const themeToggle = document.querySelector(".theme-toggle");
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const setThemeUI = (theme) => {
    const dark = theme !== "light";
    themeToggle?.setAttribute("aria-pressed", String(!dark));
    themeToggle?.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    if (themeColor) themeColor.setAttribute("content", dark ? "#0d0b14" : "#e8def7");
  };
  setThemeUI(document.documentElement.dataset.theme);
  themeToggle?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    applyTheme(next, true);
    setThemeUI(next);
  });

  const menu = document.querySelector(".menu");
  const nav = document.querySelector(".site-header nav");
  const firstNavLink = nav?.querySelector("a");
  const setMenu = (open) => {
    menu?.setAttribute("aria-expanded", String(open));
    menu?.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    nav?.classList.toggle("open", open);
  };
  menu?.addEventListener("click", () => {
    const open = menu.getAttribute("aria-expanded") !== "true";
    setMenu(open);
    if (open) firstNavLink?.focus();
  });
  nav?.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => setMenu(false)));
  document.addEventListener("click", (event) => {
    if (menu?.getAttribute("aria-expanded") !== "true") return;
    if (event.target instanceof Node && !menu.contains(event.target) && !nav?.contains(event.target)) setMenu(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu?.getAttribute("aria-expanded") === "true") {
      setMenu(false);
      menu?.focus();
    }
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > 800 && menu?.getAttribute("aria-expanded") === "true") setMenu(false);
  });

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  let observer;
  const heroArt = document.querySelector(".hero-art");
  const enter = (element, delay = 0, distance = 18) => {
    if (!element?.animate || reduce.matches) return;
    element.animate(
      [{ opacity: 0, transform: `translateY(${distance}px)` }, { opacity: 1, transform: "translateY(0)" }],
      { duration: 650, delay, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" },
    );
  };

  if (!reduce.matches) {
    document.querySelectorAll(".hero-copy > *").forEach((element, index) => enter(element, index * 55));
    enter(document.querySelector(".hero-art"), 120, 0);
    const revealItems = [...document.querySelectorAll(".showcase-intro, .showcase-art, .section-heading, .feature, .brake-panel, .closing")];
    revealItems.forEach((element) => {
      if ("IntersectionObserver" in window) {
        observer ??= new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const order = revealItems.indexOf(entry.target);
            const delay = entry.target.classList.contains("feature") ? (order % 2) * 70 : 0;
            const distance = entry.target.classList.contains("brake-panel") ? 24 : 18;
            enter(entry.target, delay, distance);
            observer.unobserve(entry.target);
          });
        }, { threshold: 0.15 });
        observer.observe(element);
      } else enter(element);
    });

    heroArt?.addEventListener("pointermove", (event) => {
      if (reduce.matches || (event.pointerType && event.pointerType !== "mouse")) return;
      const rect = heroArt.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
      heroArt.style.setProperty("--hero-shift-x", `${x * 5}px`);
      heroArt.style.setProperty("--hero-shift-y", `${y * 5}px`);
    });
    heroArt?.addEventListener("pointerleave", () => {
      heroArt.style.removeProperty("--hero-shift-x");
      heroArt.style.removeProperty("--hero-shift-y");
    });
  }
  reduce.addEventListener("change", () => {
    if (!reduce.matches) return;
    heroArt?.style.removeProperty("--hero-shift-x");
    heroArt?.style.removeProperty("--hero-shift-y");
    observer?.disconnect();
    document.getAnimations().forEach((animation) => animation.cancel());
  });
};

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
