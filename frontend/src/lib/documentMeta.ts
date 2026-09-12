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
 * Per-page document head (title + description + Open Graph + Twitter).
 * Client-rendered SPAs can't serve crawler-side meta, but this still drives
 * tab titles, history entries and JS-aware unfurlers — paired with
 * /sitemap.xml for real crawler discovery.
 */
export function useDocumentMeta(title?: string, description?: string, image?: string) {
  useEffect(() => {
    const fullTitle = title ? `${title} — حبر` : DEFAULT_TITLE;
    const text = description || DEFAULT_DESCRIPTION;
    const url = window.location.href;
    const img = image || 'https://hibr.space/hibr_logo2.png';
    document.title = fullTitle;

    const setMetaByName = (name: string, content: string) => {
      const el = upsertMeta(`meta[name="${name}"]`, () => {
        const tag = document.createElement('meta');
        tag.setAttribute('name', name);
        return tag;
      });
      el.setAttribute('content', content);
    };

    const setMetaByProperty = (property: string, content: string) => {
      const el = upsertMeta(`meta[property="${property}"]`, () => {
        const tag = document.createElement('meta');
        tag.setAttribute('property', property);
        return tag;
      });
      el.setAttribute('content', content);
    };

    setMetaByName('description', text);
    setMetaByName('twitter:card', 'summary_large_image');
    setMetaByName('twitter:title', fullTitle);
    setMetaByName('twitter:description', text);
    setMetaByName('twitter:image', img);

    setMetaByProperty('og:type', 'website');
    setMetaByProperty('og:site_name', 'حبر');
    setMetaByProperty('og:title', fullTitle);
    setMetaByProperty('og:description', text);
    setMetaByProperty('og:url', url);
    setMetaByProperty('og:image', img);

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', url);
  }, [title, description, image]);
}
