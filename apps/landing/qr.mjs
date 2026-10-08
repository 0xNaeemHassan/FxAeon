// QR codes for the landing, drawn at build time so the page never asks a
// third-party service for one and the build needs no packages. Byte mode,
// the smallest version that holds the text at error correction level M,
// raised to Q or H when that costs no extra size, and the mask with the lowest
// ISO/IEC 18004 penalty. The landing tests compare the output module for
// module with the app's pinned qrcode.react.

const LEVELS = { L: [0, 1], M: [1, 0], Q: [2, 3], H: [3, 2] }; // [table row, format bits]

// Error correction codewords per block, and blocks, by level then version (index 0 unused).
const ECC_PER_BLOCK = [
  [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const BLOCKS = [
  [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];
const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** Modules available for data and error correction in a version. */
function rawDataModules(version) {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    modules -= (25 * align - 10) * align - 55;
    if (version >= 7) modules -= 36;
  }
  return modules;
}

function dataCodewords(version, row) {
  return Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK[row][version] * BLOCKS[row][version];
}

function alignmentCenters(version) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const centers = [6];
  for (let position = version * 4 + 10; centers.length < count; position -= step) centers.splice(1, 0, position);
  return centers;
}

// Reed–Solomon over GF(2^8) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1.
function gfMultiply(a, b) {
  let product = 0;
  for (let bit = 7; bit >= 0; bit -= 1) {
    product = (product << 1) ^ ((product >>> 7) * 0x11d);
    product ^= ((b >>> bit) & 1) * a;
  }
  return product;
}

function generator(degree) {
  const coefficients = new Array(degree).fill(0);
  coefficients[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      coefficients[j] = gfMultiply(coefficients[j], root);
      if (j + 1 < degree) coefficients[j] ^= coefficients[j + 1];
    }
    root = gfMultiply(root, 2);
  }
  return coefficients;
}

function remainder(data, divisor) {
  const result = new Array(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    divisor.forEach((coefficient, index) => { result[index] ^= gfMultiply(coefficient, factor); });
  }
  return result;
}

/** Data codewords followed by their error correction, interleaved across blocks. */
function codewords(bytes, version, row) {
  const capacity = dataCodewords(version, row);
  const bits = [];
  const push = (value, length) => { for (let bit = length - 1; bit >= 0; bit -= 1) bits.push((value >>> bit) & 1); };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  push(0, Math.min(4, capacity * 8 - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity * 8; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data = [];
  for (let index = 0; index < bits.length; index += 8) data.push(bits.slice(index, index + 8).reduce((byte, bit) => (byte << 1) | bit, 0));

  const blockCount = BLOCKS[row][version];
  const eccLength = ECC_PER_BLOCK[row][version];
  const total = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blockCount - (total % blockCount);
  const shortLength = Math.floor(total / blockCount) - eccLength;
  const divisor = generator(eccLength);
  const blocks = [];
  for (let block = 0, offset = 0; block < blockCount; block += 1) {
    const length = shortLength + (block < shortBlocks ? 0 : 1);
    const part = data.slice(offset, offset + length);
    offset += length;
    blocks.push({ part, ecc: remainder(part, divisor) });
  }
  const result = [];
  for (let index = 0; index <= shortLength; index += 1) for (const { part } of blocks) if (index < part.length) result.push(part[index]);
  for (let index = 0; index < eccLength; index += 1) for (const { ecc } of blocks) result.push(ecc[index]);
  return result;
}

class Matrix {
  constructor(version) {
    this.size = version * 4 + 17;
    this.dark = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
    this.fixed = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
  }

  set(x, y, dark) {
    this.dark[y][x] = dark;
    this.fixed[y][x] = true;
  }

  drawFunctionPatterns(version, formatBits) {
    const { size } = this;
    for (let i = 0; i < size; i += 1) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
      for (let dy = -4; dy <= 4; dy += 1) {
        for (let dx = -4; dx <= 4; dx += 1) {
          const distance = Math.max(Math.abs(dx), Math.abs(dy));
          const x = cx + dx;
          const y = cy + dy;
          if (x >= 0 && x < size && y >= 0 && y < size) this.set(x, y, distance !== 2 && distance !== 4);
        }
      }
    }
    const centers = alignmentCenters(version);
    const last = centers.length - 1;
    centers.forEach((cx, i) => centers.forEach((cy, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) this.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    this.drawFormat(formatBits, 0);
    if (version >= 7) {
      let bch = version;
      for (let i = 0; i < 12; i += 1) bch = (bch << 1) ^ ((bch >>> 11) * 0x1f25);
      const bits = (version << 12) | bch;
      for (let i = 0; i < 18; i += 1) {
        const dark = ((bits >>> i) & 1) === 1;
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        this.set(a, b, dark);
        this.set(b, a, dark);
      }
    }
  }

  drawFormat(formatBits, mask) {
    const { size } = this;
    const data = (formatBits << 3) | mask;
    let bch = data;
    for (let i = 0; i < 10; i += 1) bch = (bch << 1) ^ ((bch >>> 9) * 0x537);
    const bits = ((data << 10) | bch) ^ 0x5412;
    const bit = (i) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i += 1) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i += 1) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i += 1) this.set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i += 1) this.set(8, size - 15 + i, bit(i));
    this.set(8, size - 8, true);
  }

  drawCodewords(words) {
    const { size } = this;
    let index = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      const upward = ((right + 1) & 2) === 0;
      for (let step = 0; step < size; step += 1) {
        const y = upward ? size - 1 - step : step;
        for (let x = right; x > right - 2; x -= 1) {
          if (this.fixed[y][x] || index >= words.length * 8) continue;
          this.dark[y][x] = ((words[index >>> 3] >>> (7 - (index & 7))) & 1) === 1;
          index += 1;
        }
      }
    }
  }

  applyMask(mask) {
    const invert = MASKS[mask];
    for (let y = 0; y < this.size; y += 1) {
      for (let x = 0; x < this.size; x += 1) if (!this.fixed[y][x] && invert(x, y)) this.dark[y][x] = !this.dark[y][x];
    }
  }

  /** The specification's penalty: long runs, 2×2 blocks, finder-like runs, and dark/light balance. */
  penalty() {
    const { size, dark } = this;
    let score = 0;
    const line = (read) => {
      // Runs alternate light and dark, newest first. The quiet zone around the
      // symbol counts as light at both ends.
      const runs = [0, 0, 0, 0, 0, 0, 0];
      const record = (length) => { runs.pop(); runs.unshift(runs[0] === 0 ? length + size : length); };
      const finders = () => {
        const n = runs[1];
        const core = n > 0 && runs[2] === n && runs[3] === n * 3 && runs[4] === n && runs[5] === n;
        return (core && runs[0] >= n * 4 && runs[6] >= n ? 1 : 0) + (core && runs[6] >= n * 4 && runs[0] >= n ? 1 : 0);
      };
      let color = false;
      let length = 0;
      for (let i = 0; i < size; i += 1) {
        if (read(i) === color) {
          length += 1;
          if (length === 5) score += 3;
          else if (length > 5) score += 1;
        } else {
          record(length);
          if (!color) score += finders() * 40;
          color = read(i);
          length = 1;
        }
      }
      if (color) {
        record(length);
        length = 0;
      }
      record(length + size);
      score += finders() * 40;
    };
    for (let y = 0; y < size; y += 1) line((x) => dark[y][x]);
    for (let x = 0; x < size; x += 1) line((y) => dark[y][x]);
    for (let y = 0; y < size - 1; y += 1) {
      for (let x = 0; x < size - 1; x += 1) {
        const color = dark[y][x];
        if (color === dark[y][x + 1] && color === dark[y + 1][x] && color === dark[y + 1][x + 1]) score += 3;
      }
    }
    const darkCount = dark.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
    const total = size * size;
    score += (Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1) * 10;
    return score;
  }
}

/** The QR symbol for `text` as rows of booleans (true is dark), without the quiet zone. */
export function qrModules(text, { level = 'M', boost = true } = {}) {
  if (!Object.hasOwn(LEVELS, level)) throw new Error(`Unknown QR error correction level: ${level}`);
  const bytes = [...new TextEncoder().encode(text)];
  let [row] = LEVELS[level];
  let version = 1;
  const bitsFor = (candidate) => 4 + (candidate < 10 ? 8 : 16) + bytes.length * 8;
  while (bitsFor(version) > dataCodewords(version, row) * 8) {
    version += 1;
    if (version > 40) throw new Error('Text is too long for a QR code');
  }
  if (boost) for (const higher of ['M', 'Q', 'H']) if (LEVELS[higher][0] > row && bitsFor(version) <= dataCodewords(version, LEVELS[higher][0]) * 8) row = LEVELS[higher][0];
  const formatBits = Object.values(LEVELS).find(([candidate]) => candidate === row)[1];

  const symbol = new Matrix(version);
  symbol.drawFunctionPatterns(version, formatBits);
  symbol.drawCodewords(codewords(bytes, version, row));
  let best = 0;
  let lowest = Infinity;
  for (let mask = 0; mask < MASKS.length; mask += 1) {
    symbol.applyMask(mask);
    symbol.drawFormat(formatBits, mask);
    const score = symbol.penalty();
    if (score < lowest) {
      best = mask;
      lowest = score;
    }
    symbol.applyMask(mask);
  }
  symbol.applyMask(best);
  symbol.drawFormat(formatBits, best);
  return symbol.dark;
}

/**
 * A self-contained SVG of the QR code: dark modules on a light square with
 * the four-module quiet zone scanners need. Attributes only, no styles or
 * scripts, so it fits the landing's content security policy.
 */
export function qrSvg(text, { dark = '#130e24', light = '#ffffff', quietZone = 4 } = {}) {
  const modules = qrModules(text);
  const size = modules.length + quietZone * 2;
  let path = '';
  modules.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      if (!row[x]) continue;
      let end = x;
      while (end + 1 < row.length && row[end + 1]) end += 1;
      path += `M${x + quietZone} ${y + quietZone}h${end - x + 1}v1h-${end - x + 1}z`;
      x = end;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size * 4}" height="${size * 4}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="${light}"/><path fill="${dark}" d="${path}"/></svg>\n`;
}
