const PLACEHOLDER = /YOUR_|your_|PLACEHOLDER|placeholder|CHANGE_ME|change_me|REPLACE_ME|replace_me|EXAMPLE|example/;

function requireValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  if (PLACEHOLDER.test(value)) throw new Error(`${name} contains a placeholder value`);
  return value;
}

function assertAlchemyRpc(name, expectedHost) {
  const value = requireValue(name);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTPS URL`);
  }
  if (url.protocol !== 'https:') throw new Error(`${name} must use HTTPS`);
  if (url.hostname !== expectedHost) throw new Error(`${name} must use ${expectedHost}`);
  if (url.port || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} cannot include credentials, a custom port, query, or fragment`);
  }
  if (!/^\/v2\/[^/]+\/?$/.test(url.pathname)) {
    throw new Error(`${name} must use an Alchemy /v2 application endpoint`);
  }
}

function assertTelegramMiniAppUrl() {
  const value = requireValue('NEXT_PUBLIC_TELEGRAM_APP_URL');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('NEXT_PUBLIC_TELEGRAM_APP_URL must be an absolute HTTPS URL');
  }
  if (url.protocol !== 'https:' || url.hostname !== 't.me') {
    throw new Error('NEXT_PUBLIC_TELEGRAM_APP_URL must use https://t.me/...');
  }
  if (url.username || url.password || url.port || url.search || url.hash) {
    throw new Error('NEXT_PUBLIC_TELEGRAM_APP_URL must be a clean Mini App launcher URL without credentials, query, or fragment');
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    throw new Error('NEXT_PUBLIC_TELEGRAM_APP_URL must include both bot and Mini App path segments');
  }
}

function assertCloudflareAccountId() {
  const value = requireValue('CLOUDFLARE_ACCOUNT_ID');
  if (!/^[0-9a-f]{32}$/i.test(value)) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal account ID');
  }
}

try {
  const privyAppId = requireValue('NEXT_PUBLIC_PRIVY_APP_ID');
  if (/\s/.test(privyAppId)) throw new Error('NEXT_PUBLIC_PRIVY_APP_ID cannot contain whitespace');

  assertAlchemyRpc('NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL', 'eth-mainnet.g.alchemy.com');
  assertAlchemyRpc('NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL', 'base-mainnet.g.alchemy.com');
  assertTelegramMiniAppUrl();
  requireValue('CLOUDFLARE_API_TOKEN');
  assertCloudflareAccountId();

  console.log('FxAeon production environment verified: Privy, Alchemy, Telegram, and Cloudflare configuration are structurally valid.');
} catch (error) {
  console.error(`FxAeon production environment invalid: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
