/** Return the active Pages `_headers` selector for a header entry line. */
export function findCloudflareRuleForHeader(headerLines, headerLineIndex) {
  if (!Array.isArray(headerLines) || !Number.isInteger(headerLineIndex) || headerLineIndex < 0 || headerLineIndex >= headerLines.length) {
    throw new TypeError('header lines and a valid header-line index are required');
  }
  let activeRule = null;
  for (let index = 0; index < headerLineIndex; index += 1) {
    const line = headerLines[index];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (!/^[\t ]/.test(line)) activeRule = line.trim();
  }
  return activeRule;
}
