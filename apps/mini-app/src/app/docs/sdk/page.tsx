import type { Metadata } from 'next';
import DocsShell from '../DocsShell';
import { productSections } from '../ProductArticle';
import { createDocsEntries } from '../docsSearch';
import SdkArticle, { sdkSections } from './SdkArticle';

const title = 'f(x) SDK reference';
const description = 'Explore FxAeon’s 15-method f(x) SDK integration: supported reads, transaction plans, network scope, and local patches.';
export const metadata: Metadata = {
  title: { absolute: `${title} · FxAeon` }, description,
  openGraph: { title: `${title} · FxAeon`, description, type: 'website' },
  twitter: { title: `${title} · FxAeon`, description, card: 'summary' },
};

export default function SdkPage() {
  const entries = [
    ...createDocsEntries(productSections, 'Product guide', '/docs'),
    ...createDocsEntries(sdkSections, 'SDK reference', '/docs/sdk'),
  ];
  return <DocsShell page="SDK reference" entries={entries}><SdkArticle /></DocsShell>;
}
