import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Cancel01Icon, Delete02Icon, Tick02Icon } from 'hugeicons-react';
import { useAuth } from '../../lib/AuthContext';
import {
  MAX_SOCIAL_LINKS,
  PLATFORM_ORDER,
  SOCIAL_PLATFORMS,
  normalizeSocialUrl,
  sanitizeSocialLinks,
  saveSocialLinks,
  validateSocialUrl,
  type SocialLink,
  type SocialPlatform,
} from '../../lib/socialLinks';
import Button from '../ui/Button';
import { PlatformIcon } from './SocialLinks';
import './SocialLinksEditor.css';

interface DraftRow {
  key: string;
  platform: SocialPlatform | '';
  url: string;
}

function toDrafts(links: SocialLink[]): DraftRow[] {
  return links.map((link, i) => ({
    key: `${link.platform}-${i}`,
    platform: link.platform,
    url: link.url,
  }));
}

interface SocialLinksEditorProps {
  userId: string;
  initialLinks: SocialLink[];
  onClose: () => void;
  onSaved: (links: SocialLink[]) => void;
}

function SocialLinksEditor({ userId, initialLinks, onClose, onSaved }: SocialLinksEditorProps) {
  const { getSupabaseToken } = useAuth();
  const [rows, setRows] = useState<DraftRow[]>(() => toDrafts(initialLinks));
  const [touched, setTouched] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Lock background scroll + close on Escape, matching other modals.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const usedPlatforms = new Set(rows.map((r) => r.platform).filter(Boolean) as SocialPlatform[]);
  const canAdd = rows.length < MAX_SOCIAL_LINKS && usedPlatforms.size < PLATFORM_ORDER.length;

  const addRow = () => {
    if (!canAdd) return;
    const free = PLATFORM_ORDER.find((p) => !usedPlatforms.has(p)) ?? PLATFORM_ORDER[0];
    setRows((prev) => [...prev, { key: `${free}-${Date.now()}`, platform: free, url: '' }]);
    setFormError('');
  };

  const updateRow = (key: string, patch: Partial<DraftRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setFormError('');
  };

  const removeRow = (key: string) => {
    setRows((prev) => prev.filter((r) => r.key !== key));
    setFormError('');
  };

  const rowError = (row: DraftRow): string | null => {
    if (!row.platform) return 'اختر المنصة.';
    const dupe = rows.filter((r) => r.platform === row.platform).length > 1;
    if (dupe) return 'هذه المنصة مضافة مسبقاً.';
    return validateSocialUrl(row.platform, row.url);
  };

  const handleSave = async () => {
    setTouched(true);
    setFormError('');
    if (rows.length > MAX_SOCIAL_LINKS) {
      setFormError('تقدر تضيف ٣ روابط بس.');
      return;
    }
    for (const row of rows) {
      const err = rowError(row);
      if (err) return; // inline error is shown under the row
    }
    const payload: SocialLink[] = rows.map((r) => ({
      platform: r.platform as SocialPlatform,
      url: normalizeSocialUrl(r.url),
    }));
    setIsSaving(true);
    try {
      const token = await getSupabaseToken();
      const saved = await saveSocialLinks(userId, sanitizeSocialLinks(payload), token);
      onSaved(saved);
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'تعذّر حفظ الروابط، حاول مجدداً.');
    } finally {
      setIsSaving(false);
    }
  };

  return createPortal(
    <div className="social-editor__overlay" onClick={onClose} role="presentation">
      <div
        className="social-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="social-editor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="social-editor__header">
          <div>
            <h2 id="social-editor-title" className="social-editor__title">
              روابط التواصل
            </h2>
            <p className="social-editor__subtitle">
              أضف حتى {MAX_SOCIAL_LINKS} روابط — إكس، انستقرام، سابستاك. تظهر للجميع في ملفك.
            </p>
          </div>
          <button
            type="button"
            className="social-editor__close"
            onClick={onClose}
            aria-label="إغلاق"
          >
            <Cancel01Icon size={18} strokeWidth={2} />
          </button>
        </div>

        <div className="social-editor__count" role="status" aria-live="polite">
          {rows.length} / {MAX_SOCIAL_LINKS}
        </div>

        {rows.length === 0 ? (
          <p className="social-editor__empty">ما أضفت أي رابط بعد — ابدأ بزر «أضف رابط».</p>
        ) : (
          <ul className="social-editor__list">
            {rows.map((row) => {
              const err = touched ? rowError(row) : null;
              return (
                <li key={row.key} className="social-editor__row">
                  <div className="social-editor__row-top">
                    <label className="social-editor__field">
                      <span className="sr-only">المنصة</span>
                      <span className="social-editor__select-wrap">
                        <span className="social-editor__select-icon" aria-hidden="true">
                          {row.platform ? (
                            <PlatformIcon platform={row.platform} size={16} />
                          ) : null}
                        </span>
                        <select
                          className="social-editor__select"
                          value={row.platform}
                          onChange={(e) =>
                            updateRow(row.key, { platform: e.target.value as SocialPlatform | '' })
                          }
                          aria-label="المنصة"
                        >
                          <option value="">اختر المنصة</option>
                          {PLATFORM_ORDER.map((p) => {
                            const taken =
                              usedPlatforms.has(p) && row.platform !== p;
                            return (
                              <option key={p} value={p} disabled={taken}>
                                {SOCIAL_PLATFORMS[p].label}
                                {taken ? ' — مضافة' : ''}
                              </option>
                            );
                          })}
                        </select>
                      </span>
                    </label>
                    <button
                      type="button"
                      className="social-editor__remove"
                      onClick={() => removeRow(row.key)}
                      aria-label="احذف الرابط"
                    >
                      <Delete02Icon size={16} strokeWidth={1.75} />
                    </button>
                  </div>
                  <input
                    type="url"
                    dir="ltr"
                    className={`social-editor__input${err ? ' social-editor__input--error' : ''}`}
                    placeholder={
                      row.platform
                        ? SOCIAL_PLATFORMS[row.platform].placeholder
                        : 'https://…'
                    }
                    value={row.url}
                    onChange={(e) => updateRow(row.key, { url: e.target.value })}
                    autoComplete="url"
                    inputMode="url"
                  />
                  {err ? (
                    <p className="social-editor__row-error" role="alert">
                      {err}
                    </p>
                  ) : row.platform ? (
                    <p className="social-editor__hint">{SOCIAL_PLATFORMS[row.platform].hint}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {formError && (
          <p className="social-editor__form-error" role="alert">
            {formError}
          </p>
        )}

        <div className="social-editor__footer">
          <Button variant="ghost" size="sm" onClick={addRow} disabled={!canAdd}>
            + أضف رابط
          </Button>
          <div className="social-editor__footer-actions">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={isSaving}>
              إلغاء
            </Button>
            <Button variant="primary" size="sm" onClick={handleSave} disabled={isSaving}>
              <span className="social-editor__save-inner">
                {!isSaving && <Tick02Icon size={16} strokeWidth={2} />}
                {isSaving ? 'نحفظ...' : 'حفظ الروابط'}
              </span>
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default SocialLinksEditor;
