// FxAeon landing behaviour. Loaded in <head> before the stylesheet, so the saved
// theme applies before the first paint; the rest waits for the document. The
// page is complete without this file.
(() => {
  const root = document.documentElement;
  const THEME_KEY = "fxaeon-theme";
  const read = (key) => {
    try { return window.localStorage.getItem(key); } catch { return null; }
  };
  const write = (key, value) => {
    try { window.localStorage.setItem(key, value); } catch { /* storage can be unavailable */ }
  };

  root.dataset.theme = read(THEME_KEY) === "light" ? "light" : "dark";
  root.dataset.js = "";

  const init = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const wide = window.matchMedia("(min-width: 960px)");
    const still = () => reduce.matches;

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
      [".scene", false],
      [".duo-item", true],
      [".sdk-copy", false],
      [".sdk-group", true],
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

    // Headlines are read into light: each word brightens as its line scrolls up
    // to where it is read. Words become spans; the heading's text is unchanged.
    const headlines = still() ? [] : [...document.querySelectorAll(".section-head h2, .trust-copy h2, .scene-title")].map((heading) => {
      const words = [];
      for (const node of [...heading.childNodes]) {
        if (node.nodeType !== Node.TEXT_NODE) continue;
        const fragment = document.createDocumentFragment();
        for (const part of node.textContent.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) {
            fragment.append(part);
            continue;
          }
          const word = document.createElement("span");
          word.className = "w";
          word.textContent = part;
          fragment.append(word);
          words.push(word);
        }
        node.replaceWith(fragment);
      }
      heading.classList.add("lit-heading");
      return { heading, words, lit: -1 };
    });
    let lightFrame = 0;
    const lightHeadlines = () => {
      lightFrame = 0;
      const view = window.innerHeight;
      for (const line of headlines) {
        const top = line.heading.getBoundingClientRect().top;
        // Dark while its top is in the lower tenth; fully lit by the middle.
        const progress = Math.min(1, Math.max(0, (view * 0.9 - top) / (view * 0.42)));
        const count = Math.round(progress * line.words.length);
        if (count === line.lit) continue;
        line.words.forEach((word, index) => word.toggleAttribute("data-lit", index < count));
        line.lit = count;
      }
    };
    if (headlines.length) {
      window.addEventListener("scroll", () => {
        if (!lightFrame) lightFrame = requestAnimationFrame(lightHeadlines);
      }, { passive: true });
      window.addEventListener("resize", lightHeadlines);
      lightHeadlines();
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

    // The split: 1 ETH opened at 3× with ETH at $3,000 holds 3 ETH against
    // 6,000 fxUSD. Moving the price moves only the share above the fxUSD.
    const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    const SPLIT = { eth: 3, debt: 6000, price: 3000, ceiling: 3 * 3000 * 1.2 };
    const splitInput = document.getElementById("split-price");
    const vessel = document.querySelector(".vessel");
    const splitOut = (name) => document.querySelector(`[data-split="${name}"]`);
    const renderSplit = () => {
      if (!splitInput) return;
      const move = Number(splitInput.value) / 100;
      const price = SPLIT.price * (1 + move);
      const collateral = SPLIT.eth * price;
      const share = collateral - SPLIT.debt;
      const change = share / (SPLIT.eth * SPLIT.price - SPLIT.debt) - 1;
      const sign = change > 0.0005 ? "+" : change < -0.0005 ? "−" : "±";
      const changeText = `${sign}${Math.abs(change * 100).toFixed(1)}%`;
      const leverage = collateral / share;
      splitOut("share").textContent = usd.format(share);
      splitOut("change").textContent = changeText;
      splitOut("change").dataset.tone = change > 0.0005 ? "up" : change < -0.0005 ? "down" : "";
      splitOut("collateral").textContent = usd.format(collateral);
      splitOut("price").textContent = `3 ETH at ${usd.format(price)}`;
      splitOut("leverage").textContent = `${leverage.toFixed(1)}×`;
      vessel?.style.setProperty("--share", (share / SPLIT.ceiling).toFixed(4));
      vessel?.style.setProperty("--stable", (SPLIT.debt / SPLIT.ceiling).toFixed(4));
      const movePercent = Math.round(move * 100);
      splitInput.setAttribute("aria-valuetext", `ETH ${movePercent > 0 ? "up" : movePercent < 0 ? "down" : "unchanged"}${movePercent ? ` ${Math.abs(movePercent)}%` : ""}, at ${usd.format(price)}. Your share ${usd.format(share)}, ${changeText.replace("−", "minus ").replace("+", "plus ").replace("±", "")}. fxUSD stays 6,000.`);
    };
    splitInput?.addEventListener("input", renderSplit);
    renderSplit();

    // The brake: distances from the f(x) Protocol docs' table of price falls
    // that reach the rebalance (88% LTV) and liquidation (95% LTV) lines.
    const BRAKE = { 2: [43.18, 47.37], 3: [24.24, 29.82], 4: [14.77, 21.05], 5: [9.09, 15.79], 6: [5.3, 12.28], 7: [2.6, 9.77] };
    const brake = document.querySelector(".brake-art");
    const brakeOptions = brake?.querySelector(".brake-options");
    const ruler = brake?.querySelector(".ruler");
    const showBrake = (leverage) => {
      const row = BRAKE[leverage];
      if (!brake || !row) return;
      brake.querySelectorAll(".brake-options button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.leverage === String(leverage))));
      brakeOptions?.style.setProperty("--i", String(Number(leverage) - 2));
      ruler?.style.setProperty("--rb", String(row[0]));
      ruler?.style.setProperty("--lq", String(row[1]));
      brake.querySelector('[data-brake="opened"]').textContent = `, opened at ${leverage}×`;
      brake.querySelector('[data-brake="rebalance"]').textContent = row[0].toFixed(2);
      brake.querySelector('[data-brake="liquidation"]').textContent = row[1].toFixed(2);
    };
    brake?.querySelectorAll(".brake-options button").forEach((button) => {
      button.addEventListener("click", () => showBrake(button.dataset.leverage));
    });

    // The peg: once its line has drawn, a bead traces the swing back to a
    // dollar, only while motion is welcome and the chart is on screen.
    const pegChart = document.querySelector(".peg-chart");
    const pegMotion = pegChart?.querySelector("animateMotion");
    let pegOnScreen = false;
    const syncPeg = () => {
      if (!pegChart || !pegMotion || typeof pegMotion.beginElement !== "function") return;
      const run = pegOnScreen && !still() && !document.hidden;
      if (run && !pegChart.hasAttribute("data-moving")) {
        pegChart.toggleAttribute("data-moving", true);
        pegChart.unpauseAnimations?.();
        pegMotion.beginElement();
      } else if (run) {
        pegChart.unpauseAnimations?.();
      } else if (!run && pegChart.hasAttribute("data-moving")) {
        pegChart.pauseAnimations?.();
        if (still()) {
          pegMotion.endElement();
          pegChart.removeAttribute("data-moving");
        }
      }
    };
    if (pegChart && "IntersectionObserver" in window) {
      new IntersectionObserver((entries) => {
        pegOnScreen = entries.some((entry) => entry.isIntersecting);
        // Let the line draw first; the bead follows it.
        window.setTimeout(syncPeg, pegChart.hasAttribute("data-moving") ? 0 : 1800);
      }, { threshold: 0.35 }).observe(pegChart);
      document.addEventListener("visibilitychange", syncPeg);
    }

    // What runs when you tap: each FxAeon screen and the SDK methods it uses
    // (docs/sdk-scope.md). Write methods prepare transactions; the others read state.
    const SCREENS = {
      portfolio: { label: "Portfolio", methods: ["getPositions", "getFxSaveBalance", "getFxSaveClaimable"] },
      trade: { label: "Trade", methods: ["increasePosition", "getPositions"] },
      positions: { label: "Positions", methods: ["increasePosition", "reducePosition", "adjustPositionLeverage", "getPositions"] },
      borrow: { label: "Borrow", methods: ["depositAndMint", "repayAndWithdraw", "getPositions"] },
      earn: { label: "Earn", methods: ["depositFxSave", "withdrawFxSave", "getRedeemTx", "getFxSaveConfig", "getFxSaveBalance", "getFxSaveRedeemStatus", "getFxSaveClaimable"] },
      move: { label: "Move", methods: ["buildBridgeTx", "getBridgeQuote"] },
    };
    const board = document.querySelector(".sdk-board");
    const sdkStatus = document.querySelector("[data-sdk-status]");
    const methodRows = [...(board?.querySelectorAll("li[data-method]") ?? [])];
    // "a", "a and b", "a, b and c" as text and <code> nodes.
    const appendNames = (parent, names) => names.forEach((name, index) => {
      if (index > 0) parent.append(index === names.length - 1 ? " and " : ", ");
      const element = document.createElement("code");
      element.textContent = name;
      parent.append(element);
    });
    const showSdkScreen = (key) => {
      const screen = SCREENS[key];
      if (!board || !screen) return;
      board.dataset.screen = key;
      document.querySelectorAll(".sdk-picker button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.screen === key)));
      methodRows.forEach((row) => {
        const on = screen.methods.includes(row.dataset.method);
        if (on && row.hasAttribute("data-on")) {
          // Restart the sweep so a repeated choice still answers.
          row.removeAttribute("data-on");
          void row.offsetWidth;
        }
        row.toggleAttribute("data-on", on);
      });
      if (!sdkStatus) return;
      const writes = screen.methods.filter((name) => board.querySelector(`li[data-method="${name}"]`)?.hasAttribute("data-write"));
      const reads = screen.methods.filter((name) => !writes.includes(name));
      sdkStatus.replaceChildren(`${screen.label} uses ${screen.methods.length} of 15 methods: `);
      if (writes.length) {
        appendNames(sdkStatus, writes);
        sdkStatus.append(writes.length === 1 ? " prepares its transactions" : " prepare its transactions");
      }
      if (writes.length && reads.length) sdkStatus.append("; ");
      if (reads.length) {
        appendNames(sdkStatus, reads);
        sdkStatus.append(reads.length === 1 ? " reads the state it shows" : " read the state it shows");
      }
      sdkStatus.append(".");
    };
    document.querySelectorAll(".sdk-picker button").forEach((button) => {
      button.addEventListener("click", () => showSdkScreen(button.dataset.screen));
    });
    if (board) showSdkScreen(board.dataset.screen || "trade");

    reduce.addEventListener?.("change", () => {
      syncPeg();
      if (!reduce.matches) return;
      resetPointer();
      showAll();
    });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
