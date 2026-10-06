/** Display an EVM address with enough leading and trailing characters to recognize it. */
export function compactAddress(address: string): string {
  return address.length > 10
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
}
