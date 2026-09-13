import { getSupabaseClient, supabase } from './supabase';

/**
 * Profile social links (max 3 — one per platform: X, Instagram, Substack).
 *
 * Stored as JSONB `social_links` on public.users:
 *   [{ "platform": "x", "url": "https://x.com/..." }, ...]
 *
 * The column is added by the migration at the end of
 * backend/supabase_schema.sql. Until it runs, every helper here degrades
 * gracefully: reads return [] with available=false (UI hides the section)
 * and writes throw a friendly Arabic error instead of crashing.
 */

export type SocialPlatform = 'x' | 'instagram' | 'substack';

export interface SocialLink {
  platform: SocialPlatform;
  url: string;
}

export const MAX_SOCIAL_LINKS = 3;

export const SOCIAL_PLATFORMS: Record<
  SocialPlatform,
  { label: string; placeholder: string; hint: string }
> = {
  x: {
    label: 'إكس (X)',
    placeholder: 'https://x.com/username',
    hint: 'رابط حسابك في إكس',
  },
  instagram: {
    label: 'انستقرام',
    placeholder: 'https://instagram.com/username',
    hint: 'رابط حسابك في انستقرام',
  },
  substack: {
    label: 'سابستاك',
    placeholder: 'https://username.substack.com',
    hint: 'رابط نشرتك في سابستاك',
  },
};

export const PLATFORM_ORDER: SocialPlatform[] = ['x', 'instagram', 'substack'];

function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST204' || error.code === '42703') return true;
  const msg = (error.message || '').toLowerCase();
  return msg.includes('social_links') && /column|schema|not find|not exist/i.test(msg);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

/** Trim + prepend https:// when the scheme is missing. */
export function normalizeSocialUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validate one URL for a platform. Returns an Arabic error message or null.
 */
export function validateSocialUrl(platform: SocialPlatform, input: string): string | null {
  const url = normalizeSocialUrl(input);
  if (!url) return 'أضف الرابط أولاً.';
  if (url.length > 2048) return 'الرابط طويل جداً.';
  if (!isHttpUrl(url)) return 'الرابط غير صالح — استخدم رابط يبدأ بـ https://';

  const host = hostOf(url);
  if (!host) return 'الرابط غير صالح.';

  if (platform === 'x') {
    if (!/(^|\.)(x\.com|twitter\.com)$/.test(host)) {
      return 'رابط إكس لازم يكون من x.com أو twitter.com';
    }
  } else if (platform === 'instagram') {
    if (!/(^|\.)instagram\.com$/.test(host)) {
      return 'رابط انستقرام لازم يكون من instagram.com';
    }
  } else {
    // Substack publications often live on custom domains, so any valid
    // https URL is accepted — the placeholder guides users to substack.com.
    if (!/(^|\.)substack\.com$/.test(host) && !/(^|\.)substackapp\.com$/.test(host)) {
      // Permissive: allow custom domains, no error.
    }
  }
  return null;
}

/** Clean DB JSON into at most 3 valid, de-duplicated links. */
export function sanitizeSocialLinks(raw: unknown): SocialLink[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<SocialPlatform>();
  const out: SocialLink[] = [];
  for (const item of raw) {
    if (out.length >= MAX_SOCIAL_LINKS) break;
    if (!item || typeof item !== 'object') continue;
    const { platform, url } = item as { platform?: unknown; url?: unknown };
    if (platform !== 'x' && platform !== 'instagram' && platform !== 'substack') continue;
    if (typeof url !== 'string') continue;
    const normalized = normalizeSocialUrl(url);
    if (!normalized || validateSocialUrl(platform, normalized)) continue;
    if (seen.has(platform)) continue;
    seen.add(platform);
    out.push({ platform, url: normalized });
  }
  out.sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform));
  return out;
}

export async function fetchSocialLinks(
  userId: string
): Promise<{ links: SocialLink[]; available: boolean }> {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('social_links')
      .eq('id', userId)
      .single();
    if (error) {
      if (isMissingColumnError(error)) return { links: [], available: false };
      return { links: [], available: true };
    }
    return {
      links: sanitizeSocialLinks((data as { social_links?: unknown } | null)?.social_links),
      available: true,
    };
  } catch {
    return { links: [], available: false };
  }
}

export async function saveSocialLinks(
  userId: string,
  links: SocialLink[],
  token: string | null
): Promise<SocialLink[]> {
  if (!token) throw new Error('لازم تسجّل دخولك عشان تعدّل روابطك.');
  const clean = sanitizeSocialLinks(links);
  if (links.length > MAX_SOCIAL_LINKS) {
    throw new Error('تقدر تضيف ٣ روابط بس.');
  }
  if (clean.length !== links.length) {
    throw new Error('فيه رابط غير صالح — تأكد من الروابط وحاول مجدداً.');
  }
  const client = getSupabaseClient(token);
  const { error } = await client
    .from('users')
    .update({ social_links: clean, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) {
    if (isMissingColumnError(error)) {
      throw new Error('الميزة غير مفعّلة بعد في قاعدة البيانات — نفّذ التحديث الأخير وحاول مجدداً.');
    }
    throw new Error(error.message || 'تعذّر حفظ الروابط، حاول مجدداً.');
  }
  return clean;
}
