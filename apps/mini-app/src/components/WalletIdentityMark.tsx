/** Decorative identity mark; the verified ENS/address remains the wallet identity. */
export function WalletIdentityMark() {
  return <svg viewBox="0 0 48 48" width="44" height="44" fill="none" aria-hidden="true" focusable="false">
    <path d="M24 2 44 13v22L24 46 4 35V13Z" fill="currentColor" opacity=".35" />
    <path d="m24 2 0 22L4 13Z" fill="currentColor" opacity=".95" />
    <path d="m24 2 20 11-20 11Z" fill="currentColor" opacity=".65" />
    <path d="m4 13 20 11L4 35Z" fill="currentColor" opacity=".55" />
    <path d="m44 13-20 11 20 11Z" fill="currentColor" opacity=".85" />
    <path d="m4 35 20-11v22Z" fill="currentColor" opacity=".85" />
    <path d="m44 35-20-11v22Z" fill="currentColor" opacity=".45" />
  </svg>;
}
