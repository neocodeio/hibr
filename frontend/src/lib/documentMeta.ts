import { useEffect } from 'react';

const DEFAULT_TITLE = 'حبر';
const DEFAULT_DESCRIPTION = 'حِبر — منصة نشر عربية، للكتّاب اللي يكتبون اللي يستاهل ينقري';

function upsertMeta(selector: string, create: () => HTMLMetaElement): HTMLMetaElement {
  const existing = document.head.querySelector<HTMLMetaElement>(selector);
  if (existing) return existing;
  const el = create();
  document.head.appendChild(el);
  return el;
}

/**
 * Per-page document head (title + description + Open Graph). Client-rendered
 * SPAs can't serve crawler-side meta, but this still drives tab titles,
 * history entries and JS-aware unfurlers — paired with /sitemap.xml for
 * real crawler discovery.
 */
export function useDocumentMeta(title?: string, description?: string) {
  useEffect(() => {
    const fullTitle = title ? `${title} — حبر` : DEFAULT_TITLE;
    const text = description || DEFAULT_DESCRIPTION;
    document.title = fullTitle;

    const desc = upsertMeta('meta[name="description"]', () => {
      const el = document.createElement('meta');
      el.setAttribute('name', 'description');
      return el;
    });
    desc.setAttribute('content', text);

    const ogTitle = upsertMeta('meta[property="og:title"]', () => {
      const el = document.createElement('meta');
      el.setAttribute('property', 'og:title');
      return el;
    });
    ogTitle.setAttribute('content', fullTitle);

    const ogDesc = upsertMeta('meta[property="og:description"]', () => {
      const el = document.createElement('meta');
      el.setAttribute('property', 'og:description');
      return el;
    });
    ogDesc.setAttribute('content', text);
  }, [title, description]);
}
