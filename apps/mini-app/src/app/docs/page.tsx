import DocsShell from './DocsShell';
import ProductArticle, { productSections } from './ProductArticle';
import { sdkSections } from './sdk/SdkArticle';
import { createDocsEntries } from './docsSearch';

export default function DocsPage() {
  const entries = [
    ...createDocsEntries(productSections, 'Product guide', '/docs'),
    ...createDocsEntries(sdkSections, 'SDK reference', '/docs/sdk'),
  ];
  return <DocsShell page="Product guide" entries={entries}><ProductArticle /></DocsShell>;
}
