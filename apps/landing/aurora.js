// The aurora behind the page: a domain-warped noise field drawn with raw WebGL
// at a fraction of the screen's resolution, 30 frames a second at most. The
// CSS gradient beneath it is the still frame, so no WebGL, Save-Data, or a lost
// context all leave a complete page. Reduced motion and the motion control
// hold one frame; a hidden tab stops drawing.
(() => {
  const host = document.querySelector(".aurora");
  const canvas = host?.querySelector("canvas");
  if (!host || !canvas) return;

  const root = document.documentElement;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const saveData = Boolean(navigator.connection && navigator.connection.saveData);

  let gl = null;
  try {
    gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "low-power",
    });
  } catch {
    gl = null;
  }
  if (!gl) return;

  const VERTEX = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  const FRAGMENT = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_pointer;
uniform float u_scroll;
uniform vec3 u_c0;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec3 u_bg;

float hash(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}

// One curtain of light: a bright hem whose height wanders with x and time,
// rays falling from it, and a long glow beneath.
float curtain(vec2 p, float seed, float t, float hem, float reach) {
  float wander = fbm(vec2(p.x * 0.8 + seed, t * 0.5 + seed * 0.37));
  float d = hem + (wander - 0.5) * 0.3 - p.y;
  float body = d > 0.0 ? exp(-d / reach) : exp(-pow(d * 26.0, 2.0));
  float rays = 0.42 + 0.58 * noise(vec2(p.x * 28.0 + seed * 11.0, t * 1.4 + seed));
  rays *= 0.62 + 0.38 * noise(vec2(p.x * 6.0 - seed * 3.0, t * 0.6));
  return body * rays;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float width = max(u_res.x / u_res.y, 0.75);
  vec2 p = vec2(uv.x * width, uv.y);
  float t = u_time * 0.08;

  vec2 toPointer = vec2(u_pointer.x * width, u_pointer.y) - p;
  float near = exp(-dot(toPointer, toPointer) * 5.0);
  p.x += toPointer.x * near * 0.12;

  // The curtains hang high above the hero and settle low behind the finale;
  // between the two they dim so reading stays calm.
  float s = u_scroll;
  float hem = mix(0.78, 0.42, s);
  float strength = 0.36 + 0.64 * pow(abs(2.0 * s - 1.0), 1.4);

  float a = curtain(p, 0.0, t, hem, 0.34);
  float b = curtain(p * vec2(1.35, 1.0), 4.7, t * 1.15, hem - 0.06, 0.2);
  float c = curtain(p * vec2(0.75, 1.0), 9.3, t * 0.85, hem + 0.05, 0.46);

  float haze = fbm(p * 1.1 + vec2(t * 0.3, -t * 0.2));
  vec3 color = mix(u_bg, u_c0, clamp(haze * 0.75 * (0.25 + 0.75 * uv.y), 0.0, 1.0));
  // Mixes are capped so text keeps WCAG AA contrast on the brightest frame.
  color = mix(color, u_c1, clamp(a * 0.9 * strength, 0.0, 1.0));
  color = mix(color, u_c3, clamp(c * 0.22 * strength, 0.0, 1.0));
  color = mix(color, u_c2, clamp(b * 0.22 * strength, 0.0, 1.0));
  color = mix(color, u_c2, near * 0.07);

  color += (hash(gl_FragCoord.xy + fract(u_time)) - 0.5) / 160.0;
  gl_FragColor = vec4(color, 1.0);
}`;

  const compile = (type, source) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    gl.deleteShader(shader);
    return null;
  };
  const vertex = compile(gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
  const program = vertex && fragment ? gl.createProgram() : null;
  if (!program) return;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
  gl.useProgram(program);

  // One triangle that covers the screen.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const uniform = (name) => gl.getUniformLocation(program, name);
  const u = {
    res: uniform("u_res"),
    time: uniform("u_time"),
    pointer: uniform("u_pointer"),
    scroll: uniform("u_scroll"),
    colors: ["u_c0", "u_c1", "u_c2", "u_c3"].map(uniform),
    bg: uniform("u_bg"),
  };

  const parse = (value, fallback) => {
    const hex = value.trim().replace("#", "");
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    if (!/^[0-9a-f]{6}$/i.test(full)) return fallback;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  };
  const readColors = () => {
    const style = getComputedStyle(root);
    ["--aurora-0", "--aurora-1", "--aurora-2", "--aurora-3"].forEach((name, index) => {
      gl.uniform3fv(u.colors[index], parse(style.getPropertyValue(name), [0.4, 0.3, 0.9]));
    });
    gl.uniform3fv(u.bg, parse(style.getPropertyValue("--aurora-bg"), [0.03, 0.03, 0.05]));
  };

  const scrollProgress = () => {
    const range = document.documentElement.scrollHeight - window.innerHeight;
    return range > 0 ? Math.min(1, Math.max(0, window.scrollY / range)) : 0;
  };

  // A soft field needs few pixels: about a third of a CSS pixel on standard
  // screens and half on dense ones, capped for very large windows.
  const resize = () => {
    const ratio = Math.min(0.5, 0.34 * (window.devicePixelRatio || 1));
    const width = Math.max(2, Math.min(1100, Math.round(window.innerWidth * ratio)));
    const height = Math.max(2, Math.min(760, Math.round(window.innerHeight * ratio)));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
    gl.uniform2f(u.res, width, height);
  };

  // A still frame opens on a settled part of the field rather than its seed.
  let time = 14;
  let scroll = scrollProgress();
  let scrollTarget = scroll;
  const pointer = { x: -4, y: -4, tx: -4, ty: -4 };

  const draw = () => {
    gl.uniform1f(u.time, time);
    gl.uniform1f(u.scroll, scroll);
    gl.uniform2f(u.pointer, pointer.x, pointer.y);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const still = () => reduce.matches || saveData || root.dataset.motion === "paused";
  let running = false;
  let frame = 0;
  let last = 0;
  const STEP = 1000 / 30;

  const tick = (now) => {
    frame = 0;
    if (!running) return;
    frame = requestAnimationFrame(tick);
    if (now - last < STEP - 2) return;
    const elapsed = Math.min(now - last, 100);
    last = now;
    time += elapsed / 1000;
    scroll += (scrollTarget - scroll) * 0.08;
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    draw();
  };

  // Draws one frame on the next animation frame when the loop is not running.
  let pending = 0;
  const redraw = () => {
    if (running || pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      scroll = scrollTarget;
      draw();
    });
  };

  const sync = () => {
    const run = !still() && !document.hidden;
    if (run && !running) {
      running = true;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    } else if (!run && running) {
      running = false;
      cancelAnimationFrame(frame);
      frame = 0;
      pointer.x = pointer.tx = -4;
      pointer.y = pointer.ty = -4;
      redraw();
    }
  };

  window.addEventListener("scroll", () => {
    scrollTarget = scrollProgress();
    redraw();
  }, { passive: true });
  window.addEventListener("resize", () => {
    resize();
    scrollTarget = scrollProgress();
    redraw();
  });
  window.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse" || !running) return;
    pointer.tx = event.clientX / window.innerWidth;
    pointer.ty = 1 - event.clientY / window.innerHeight;
  }, { passive: true });
  document.addEventListener("visibilitychange", sync);
  reduce.addEventListener?.("change", sync);
  new MutationObserver((records) => {
    if (records.some((record) => record.attributeName === "data-theme")) readColors();
    sync();
    redraw();
  }).observe(root, { attributes: true, attributeFilter: ["data-theme", "data-motion"] });

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    running = false;
    cancelAnimationFrame(frame);
    host.removeAttribute("data-live");
  });

  resize();
  readColors();
  draw();
  host.dataset.live = "";
  sync();
})();
