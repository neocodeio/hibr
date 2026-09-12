import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ breaks: true, gfm: true });

/**
 * Render post Markdown to sanitized HTML. Plain-text posts (the historical
 * format) render as clean paragraphs; Markdown adds headings, quotes,
 * lists, code and links. DOMPurify strips scripts/handlers, so the result
 * is safe for dangerouslySetInnerHTML.
 */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source || '') as string;
  return DOMPurify.sanitize(html);
}
