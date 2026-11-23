import { ChangelogPage } from '@/components/download/ChangelogPage';
import './changelog.css';

/* Metadata lives in changelog/layout.tsx (routeMetadata + SEO.changelog).
   A local `metadata` export would override it with a generic "Changelog"
   title — see docs/SEO-WORDS-V1144.md §3.3. */
export default function Page() {
  return <ChangelogPage />;
}
