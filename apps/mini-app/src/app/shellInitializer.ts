/**
 * Runs in <head> before the first paint and before React hydrates, so what it
 * decides is right on the first frame. The build hashes it into the
 * Content-Security-Policy (scripts/generate_csp_headers.mjs). `r` is the root
 * element; every part guards its own storage access.
 */

/** Theme: the saved palette. Earlier releases used "dark" for today's
 * Official, so the legacy key only keeps an explicit light choice. */
const THEME = "try{const v=localStorage.getItem('fxaeon_theme_id_v2');const t=v==='official'||v==='dark'||v==='light'?v:localStorage.getItem('fxaeon_theme_id')==='light'?'light':'official';r.dataset.theme=t;r.style.colorScheme=t==='light'?'light':'dark';}catch{}";

/** Route headings arrive lit once per session (globals.css, heading-light):
 * when the first sweep ends the root is marked, and later pages and reloads
 * in this session show plain titles from their first frame. */
export const HEADING_LIT_KEY = 'fxaeon_heading_lit';
const HEADING = `try{if(sessionStorage.getItem('${HEADING_LIT_KEY}'))r.dataset.headingLit='';}catch{}`
  + "document.addEventListener('animationend',function l(e){if(e.animationName!=='heading-light')return;r.dataset.headingLit='';document.removeEventListener('animationend',l);"
  + `try{sessionStorage.setItem('${HEADING_LIT_KEY}','1');}catch{}});`;

export const SHELL_INITIALIZER = `(()=>{const r=document.documentElement;${THEME}${HEADING}})();`;
