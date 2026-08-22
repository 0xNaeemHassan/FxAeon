/**
 * Unit Tests for 3D Holographic Cards and Voice Announcer
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// 1. Holo Parallax Transform Math
function calculateCardTilt(x, y, cardWidth, cardHeight, maxTiltDeg = 16) {
  const centerX = cardWidth / 2;
  const centerY = cardHeight / 2;
  let rotateX = ((y - centerY) / centerY) * -maxTiltDeg;
  let rotateY = ((x - centerX) / centerX) * maxTiltDeg;
  if (Object.is(rotateX, -0)) rotateX = 0;
  if (Object.is(rotateY, -0)) rotateY = 0;
  const glareX = (x / cardWidth) * 100;
  const glareY = (y / cardHeight) * 100;
  return { rotateX, rotateY, glareX, glareY };
}

// 2. Gyroscope Angle Clamping Math
function clampGyroscopeAngles(gamma, beta, maxAngle = 18) {
  const clampedGamma = Math.max(-30, Math.min(30, gamma ?? 0));
  const clampedBeta = Math.max(-30, Math.min(30, (beta ?? 45) - 45));
  let rotateY = (clampedGamma / 30) * maxAngle;
  let rotateX = -(clampedBeta / 30) * maxAngle;
  if (Object.is(rotateX, -0)) rotateX = 0;
  if (Object.is(rotateY, -0)) rotateY = 0;
  return { rotateX, rotateY };
}

// 3. Announcer Persona Formatter
function formatTradeAnnounceText(persona, side, leverage, market) {
  const levText = `${leverage}X`;
  if (persona === 'cyberpunk') {
    return `Execution verified. ${side.toUpperCase()} ${levText} leverage opened on ${market}. Godspeed.`;
  }
  if (persona === 'hype') {
    return `BOOM! New ${side.toUpperCase()} locked in at ${levText} on ${market}! Let it ride anon!`;
  }
  return `${market} ${side} order executed at ${levText} leverage. Risk parameters secured.`;
}

test('calculateCardTilt accurately maps pointer coordinates to 3D rotation angles and glare coordinates', () => {
  const width = 300;
  const height = 400;

  // Center pointer -> 0 deg rotation, 50% glare
  const center = calculateCardTilt(150, 200, width, height, 16);
  assert.equal(center.rotateX, 0);
  assert.equal(center.rotateY, 0);
  assert.equal(center.glareX, 50);
  assert.equal(center.glareY, 50);

  // Top-Right pointer -> negative rotateX, positive rotateY
  const topRight = calculateCardTilt(300, 0, width, height, 16);
  assert.equal(topRight.rotateX, 16);
  assert.equal(topRight.rotateY, 16);
  assert.equal(topRight.glareX, 100);
  assert.equal(topRight.glareY, 0);
});

test('clampGyroscopeAngles keeps phone tilt within safe physical boundaries', () => {
  const neutral = clampGyroscopeAngles(0, 45, 18);
  assert.equal(neutral.rotateX, 0);
  assert.equal(neutral.rotateY, 0);

  const extremeTilt = clampGyroscopeAngles(90, 180, 18);
  assert.equal(extremeTilt.rotateY, 18);
  assert.equal(extremeTilt.rotateX, -18);
});

test('formatTradeAnnounceText crafts custom persona dialogue', () => {
  const cyber = formatTradeAnnounceText('cyberpunk', 'long', 5, 'wstETH');
  assert.ok(cyber.includes('Execution verified. LONG 5X'));
  assert.ok(cyber.includes('Godspeed.'));

  const hype = formatTradeAnnounceText('hype', 'short', 10, 'WBTC');
  assert.ok(hype.includes('BOOM! New SHORT'));
  assert.ok(hype.includes('Let it ride anon!'));

  const zen = formatTradeAnnounceText('zen', 'long', 2, 'wstETH');
  assert.ok(zen.includes('Risk parameters secured.'));
});
