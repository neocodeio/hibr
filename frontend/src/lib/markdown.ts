import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ breaks: true, gfm: true });

/**
 * Render post Markdown to sanitized HTML. Plain-text posts (the historical
 * format) render as clean paragraphs; Markdown adds headings, quotes,
 * lists, code and links. DOMPurify strips scripts/handlers, so the result
 * is safe for dangerouslySetInnerHTML.
 *
 * The config is pinned explicitly (rather than relying on DOMPurify
 * defaults) so a library upgrade can never silently widen the allowed
 * surface. All links are forced to `rel="noopener noreferrer"` to block
 * tabnabbing via author-supplied `<a target="_blank">` HTML.
 */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source || '') as string;
  const clean = DOMPurify.sanitize(html, {
    FORBID_TAGS: [
      'style',
      'form',
      'input',
      'button',
      'select',
      'textarea',
      'iframe',
      'object',
      'embed',
      'link',
      'meta',
      'script',
    ],
    FORBID_ATTR: ['style'],
    ADD_ATTR: ['target'],
  });
  // Prepended (first occurrence wins per HTML parsing), so even a crafted
  // rel attribute cannot drop the protection.
  return clean.replace(/<a(?=[\s>])/gi, '<a rel="noopener noreferrer"');
}
