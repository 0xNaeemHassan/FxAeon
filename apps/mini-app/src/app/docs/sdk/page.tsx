import type { Metadata } from 'next';
import { routeMetadata } from '@/app/routeMetadata';
import DocsShell from '../DocsShell';
import { productSections } from '../ProductArticle';
import { createDocsEntries } from '../docsSearch';
import SdkArticle, { sdkSections } from './SdkArticle';

// The shared route metadata keeps the FxAeon banner on share cards.
export const metadata: Metadata = routeMetadata('docsSdk');

export default function SdkPage() {
  const entries = [
    ...createDocsEntries(productSections, 'Product guide', '/docs'),
    ...createDocsEntries(sdkSections, 'SDK reference', '/docs/sdk'),
  ];
  return <DocsShell page="SDK reference" entries={entries}><SdkArticle /></DocsShell>;
}
