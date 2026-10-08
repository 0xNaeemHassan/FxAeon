/**
 * Runs in <head> before the first paint and before React hydrates, so what it
 * decides is right on the first frame. The build hashes it into the
 * Content-Security-Policy (scripts/generate_csp_headers.mjs).
 *
 * Theme: the saved palette (earlier releases used "dark" for today's
 * Official, so the legacy key only keeps an explicit light choice).
 */
export const SHELL_INITIALIZER = `(()=>{try{const v=localStorage.getItem('fxaeon_theme_id_v2');const t=v==='official'||v==='dark'||v==='light'?v:localStorage.getItem('fxaeon_theme_id')==='light'?'light':'official';const r=document.documentElement;r.dataset.theme=t;r.style.colorScheme=t==='light'?'light':'dark';}catch{}})();`;
