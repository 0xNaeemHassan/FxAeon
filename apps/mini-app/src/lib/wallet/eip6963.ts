export type Eip6963Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};
export type Eip6963Announcement = { info?: { rdns?: string; name?: string }; provider?: Eip6963Provider };
export type DiscoveredEip6963Provider = { provider: Eip6963Provider; name: string; rdns: string };
const discovered: DiscoveredEip6963Provider[] = [];
const safeText = (value: unknown, fallback: string) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e]/g, '').trim().slice(0, 96) || fallback : fallback;
export function recordEip6963Announcement(announcement: Eip6963Announcement): DiscoveredEip6963Provider | null {
  if (!announcement.provider || discovered.some((item) => item.provider === announcement.provider)) return null;
  const index = discovered.length + 1;
  const item = { provider: announcement.provider, name: safeText(announcement.info?.name, 'Browser wallet'), rdns: safeText(announcement.info?.rdns, `unknown-wallet-${index}`) };
  discovered.push(item);
  return item;
}
export function getDiscoveredEip6963Providers(): readonly DiscoveredEip6963Provider[] { return discovered; }
export function selectEip6963Provider(rdns: string | null | undefined): DiscoveredEip6963Provider | undefined { return rdns ? discovered.find((candidate) => candidate.rdns === rdns) : undefined; }
export function shouldPromptEip6963Provider(preferredRdns?: string | null): boolean { return discovered.length > 1 && !selectEip6963Provider(preferredRdns); }
export function clearEip6963AnnouncementsForTest(): void { discovered.splice(0, discovered.length); }
