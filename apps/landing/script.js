// FxAeon landing behaviour. Loaded in <head> before the stylesheet, so the saved
// theme and motion choice apply before the first paint; the rest waits for the
// document. The page is complete without this file.
(() => {
  const root = document.documentElement;
  const THEME_KEY = "fxaeon-theme";
  const MOTION_KEY = "fxaeon-motion";
  const read = (key) => {
    try { return window.localStorage.getItem(key); } catch { return null; }
  };
  const write = (key, value) => {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch { /* storage can be unavailable */ }
  };

  root.dataset.theme = read(THEME_KEY) === "light" ? "light" : "dark";
  if (read(MOTION_KEY) === "paused") root.dataset.motion = "paused";
  root.dataset.js = "";

  const init = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const wide = window.matchMedia("(min-width: 960px)");
    const still = () => reduce.matches || root.dataset.motion === "paused";

    const year = document.getElementById("year");
    if (year) year.textContent = String(new Date().getFullYear());

    // Header: a surface only once the page has scrolled beneath it.
    const header = document.querySelector(".site-header");
    let headerFrame = 0;
    const syncHeader = () => {
      headerFrame = 0;
      header?.toggleAttribute("data-scrolled", window.scrollY > 8);
    };
    window.addEventListener("scroll", () => {
      if (!headerFrame) headerFrame = requestAnimationFrame(syncHeader);
    }, { passive: true });
    syncHeader();

    // Theme: the new theme spreads from the toggle where View Transitions exist.
    const themeToggle = document.querySelector(".theme-toggle");
    const themeColor = document.querySelector('meta[name="theme-color"]');
    const syncTheme = () => {
      const dark = root.dataset.theme !== "light";
      themeToggle?.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
      themeColor?.setAttribute("content", dark ? "#08070d" : "#f6f4f0");
    };
    syncTheme();
    themeToggle?.addEventListener("click", () => {
      const next = root.dataset.theme === "light" ? "dark" : "light";
      const apply = () => {
        root.dataset.theme = next;
        write(THEME_KEY, next);
        syncTheme();
      };
      if (!document.startViewTransition || still()) {
        apply();
        return;
      }
      const box = themeToggle.getBoundingClientRect();
      root.style.setProperty("--vt-x", `${Math.round(box.left + box.width / 2)}px`);
      root.style.setProperty("--vt-y", `${Math.round(box.top + box.height / 2)}px`);
      document.startViewTransition(apply);
    });

    // Menu on narrow screens.
    const menu = document.querySelector(".menu");
    const nav = document.querySelector(".site-header nav");
    const setMenu = (open) => {
      menu?.setAttribute("aria-expanded", String(open));
      menu?.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      nav?.classList.toggle("open", open);
    };
    menu?.addEventListener("click", () => {
      const open = menu.getAttribute("aria-expanded") !== "true";
      setMenu(open);
      if (open) nav?.querySelector("a")?.focus();
    });
    nav?.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => setMenu(false)));
    document.addEventListener("click", (event) => {
      if (menu?.getAttribute("aria-expanded") !== "true") return;
      if (event.target instanceof Node && !menu.contains(event.target) && !nav?.contains(event.target)) setMenu(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || menu?.getAttribute("aria-expanded") !== "true") return;
      setMenu(false);
      menu.focus();
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth > 860 && menu?.getAttribute("aria-expanded") === "true") setMenu(false);
    });

    // Chapters: one phone follows the chapter at the middle of the screen on
    // wide screens; narrow screens get a phone inside each chapter.
    const TAB = { portfolio: 0, trade: 1, earn: 2, borrow: 2, move: 3 };
    const chapters = [...document.querySelectorAll(".chapter")];
    const chapterList = document.querySelector(".chapters");
    const stagePhone = document.querySelector(".chapter-stage .phone");
    const stageScreens = [...(stagePhone?.querySelectorAll(".screen") ?? [])];
    const order = stageScreens.map((screen) => screen.dataset.for);
    const showScreen = (name) => {
      const index = order.indexOf(name);
      if (!stagePhone || index < 0) return;
      stagePhone.dataset.screen = name;
      stageScreens.forEach((screen, i) => {
        screen.dataset.state = i === index ? "active" : i < index ? "before" : "after";
      });
      stagePhone.querySelector(".app-tabbar")?.setAttribute("data-tab", String(TAB[name] ?? 0));
      stageScreens[index].toggleAttribute("data-drawn", true);
    };
    const activate = (name) => {
      chapters.forEach((chapter) => chapter.toggleAttribute("data-active", chapter.dataset.chapter === name));
      if (wide.matches) showScreen(name);
    };

    chapters.forEach((chapter) => {
      const holder = chapter.querySelector(".chapter-phone");
      const screen = stagePhone?.querySelector(`.screen[data-for="${chapter.dataset.chapter}"]`);
      if (!holder || !screen || holder.childElementCount) return;
      const phone = document.createElement("div");
      phone.className = "phone";
      phone.dataset.screen = chapter.dataset.chapter;
      stagePhone.querySelectorAll(".phone-status, .phone-notch").forEach((part) => phone.append(part.cloneNode(true)));
      const copy = screen.cloneNode(true);
      copy.dataset.state = "active";
      phone.append(copy);
      const tabs = stagePhone.querySelector(".app-tabbar")?.cloneNode(true);
      if (tabs) {
        tabs.setAttribute("data-tab", String(TAB[chapter.dataset.chapter] ?? 0));
        phone.append(tabs);
      }
      holder.append(phone);
    });

    const syncPinned = () => chapterList?.toggleAttribute("data-pinned", wide.matches);
    syncPinned();
    wide.addEventListener?.("change", () => {
      syncPinned();
      const active = chapters.find((chapter) => chapter.hasAttribute("data-active"));
      if (active) showScreen(active.dataset.chapter);
    });

    if ("IntersectionObserver" in window) {
      const middle = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) activate(entry.target.dataset.chapter);
        });
      }, { rootMargin: "-50% 0px -50% 0px" });
      chapters.forEach((chapter) => middle.observe(chapter));

      // Charts and meters draw in when their screen first comes into view.
      const drawn = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.toggleAttribute("data-drawn", true);
          drawn.unobserve(entry.target);
        });
      }, { threshold: 0.35 });
      document.querySelectorAll(".chapter-phone .screen").forEach((screen) => drawn.observe(screen));
      const stage = document.querySelector(".chapter-stage");
      if (stage) {
        const stageView = new IntersectionObserver((entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          stagePhone?.querySelector('.screen[data-state="active"]')?.toggleAttribute("data-drawn", true);
          stageView.disconnect();
        }, { threshold: 0.35 });
        stageView.observe(stage);
      }
    } else {
      document.querySelectorAll(".screen").forEach((screen) => screen.toggleAttribute("data-drawn", true));
    }

    // Reveals: sections rise once as they arrive. Without motion everything is
    // simply present.
    // [selector, whether members of the group arrive one after another]
    const revealGroups = [
      [".section-head", false],
      [".chapter", false],
      [".mechanic", true],
      [".trust-copy", false],
      [".review-card", false],
      [".chat", false],
      [".steps li", true],
      [".faq-list", false],
      [".finale > *", true],
    ];
    const showAll = () => {
      document.querySelectorAll("[data-reveal]").forEach((element) => element.toggleAttribute("data-shown", true));
      document.querySelectorAll(".screen").forEach((screen) => screen.toggleAttribute("data-drawn", true));
    };
    if (!still() && "IntersectionObserver" in window) {
      const reveal = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.toggleAttribute("data-shown", true);
          reveal.unobserve(entry.target);
        });
      }, { rootMargin: "0px 0px -10% 0px", threshold: 0.1 });
      revealGroups.forEach(([selector, staggered]) => {
        document.querySelectorAll(selector).forEach((element, index) => {
          // Whatever is already on screen stays put; only what is still to come rises in.
          if (element.getBoundingClientRect().top < window.innerHeight) return;
          element.dataset.reveal = "";
          if (staggered) element.style.setProperty("--i", String(index));
          reveal.observe(element);
        });
      });
    } else {
      showAll();
    }

    // The hero answers the pointer: the phone tilts toward it, the tokens move
    // by depth, and the glass catches the light.
    const heroStage = document.querySelector(".hero-stage");
    const heroPhone = heroStage?.querySelector(".phone");
    const orbs = [...(heroStage?.querySelectorAll(".orb") ?? [])];
    const DEPTH = { near: 22, mid: 12, far: 6 };
    let heroVisible = true;
    let pointerFrame = 0;
    let px = 0;
    let py = 0;
    const applyPointer = () => {
      pointerFrame = 0;
      if (!heroPhone) return;
      heroPhone.style.setProperty("--tilt-y", `${(-14 + px * 9).toFixed(2)}deg`);
      heroPhone.style.setProperty("--tilt-x", `${(6 - py * 7).toFixed(2)}deg`);
      heroPhone.style.setProperty("--glare-x", `${(62 - px * 30).toFixed(1)}%`);
      orbs.forEach((orb) => {
        const depth = DEPTH[orb.dataset.depth] ?? 10;
        orb.style.setProperty("--px", `${(px * depth).toFixed(1)}px`);
        orb.style.setProperty("--py", `${(py * depth).toFixed(1)}px`);
      });
    };
    const resetPointer = () => {
      px = 0;
      py = 0;
      heroPhone?.style.removeProperty("--tilt-y");
      heroPhone?.style.removeProperty("--tilt-x");
      heroPhone?.style.removeProperty("--glare-x");
      orbs.forEach((orb) => {
        orb.style.removeProperty("--px");
        orb.style.removeProperty("--py");
      });
    };
    if ("IntersectionObserver" in window && heroStage) {
      new IntersectionObserver((entries) => {
        heroVisible = entries.some((entry) => entry.isIntersecting);
      }).observe(heroStage);
    }
    window.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "mouse" || !finePointer.matches || still() || !heroVisible) return;
      px = Math.max(-1, Math.min(1, (event.clientX / window.innerWidth) * 2 - 1));
      py = Math.max(-1, Math.min(1, (event.clientY / window.innerHeight) * 2 - 1));
      if (!pointerFrame) pointerFrame = requestAnimationFrame(applyPointer);
    }, { passive: true });

    // Protocol cards light up under the pointer.
    document.querySelectorAll(".mechanic").forEach((card) => {
      card.addEventListener("pointermove", (event) => {
        const box = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${Math.round(event.clientX - box.left)}px`);
        card.style.setProperty("--my", `${Math.round(event.clientY - box.top)}px`);
      });
    });

    // Motion control: pauses every loop, the aurora, and the pointer response.
    const motionToggle = document.querySelector(".motion-toggle");
    const motionLabel = motionToggle?.querySelector(".motion-label");
    const syncMotion = () => {
      const paused = root.dataset.motion === "paused";
      if (motionLabel) motionLabel.textContent = paused ? "Play motion" : "Pause motion";
    };
    syncMotion();
    motionToggle?.addEventListener("click", () => {
      const pause = root.dataset.motion !== "paused";
      if (pause) {
        root.dataset.motion = "paused";
        resetPointer();
        showAll();
      } else {
        delete root.dataset.motion;
      }
      write(MOTION_KEY, pause ? "paused" : null);
      syncMotion();
    });

    reduce.addEventListener?.("change", () => {
      if (!reduce.matches) return;
      resetPointer();
      showAll();
    });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
