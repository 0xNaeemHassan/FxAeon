/**
 * Vendor noise suppression (W-15).
 *
 * @aladdindao/fx-sdk's bundled dist unconditionally does
 * `console.log("poolData-->", poolData)` inside a hot query path, dumping
 * full pool structs to stdout on every call. We cannot edit the vendored
 * bundle from CI, so this targeted shim drops exactly that call and nothing
 * else. Remove when the SDK ships without the debug line.
 */
const INSTALLED = Symbol.for("fxbot.vendorLogFilter");

export function installVendorLogFilter(): void {
  const c = console as Console & { [INSTALLED]?: boolean };
  if (c[INSTALLED]) return;
  const original = console.log.bind(console);
  console.log = (...args: unknown[]) => {
    if (args.length > 0 && args[0] === "poolData-->") return;
    original(...args);
  };
  c[INSTALLED] = true;
}
