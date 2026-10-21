import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import {
  sanitizeText,
  sanitizeTaxId,
  sanitizePhone,
  sanitizeEmail,
  sanitizeEmailInput,
} from '../lib/sanitize.js';
import { EMPTY_COMPANY } from '../lib/draft.js';
import { Button, TextField } from './ui.jsx';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export default function CompanyModal({ company, onSave, onClose }) {
  const { t, region } = useI18n();
  const [form, setForm] = useState({ ...EMPTY_COMPANY, ...company });
  const [emailError, setEmailError] = useState(false);
  const dialogRef = useRef(null);

  const set = (key) => (value) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (key === 'email') setEmailError(false);
  };

  // Focus management: focus the dialog on open, restore focus on close, trap Tab, close on Escape.
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.querySelector('input')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Tab' && dialogRef.current) {
        const nodes = [...dialogRef.current.querySelectorAll(FOCUSABLE)];
        if (!nodes.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (previous && previous.focus) previous.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e) => {
    e.preventDefault();
    const email = form.email.trim();
    if (email && !sanitizeEmail(email)) return setEmailError(true);
    return onSave(form);
  };

  const taxLabel = t(`company.taxId.${region.code}`);

  return (
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center bg-black/80 sm:items-center sm:p-4">
      <button type="button" tabIndex={-1} aria-hidden="true" className="absolute inset-0 cursor-default" onClick={onClose} />
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="company-title"
        onSubmit={submit}
        className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-neutral-700 bg-black p-5 sm:rounded-3xl"
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 id="company-title" className="text-2xl font-bold">
            {t('company.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-neutral-700 text-xl hover:border-brand"
          >
            ×
          </button>
        </div>
        <p className="mb-5 text-sm text-neutral-300">{t('company.subtitle')}</p>

        <div className="space-y-4">
          <TextField label={t('company.name')} value={form.name} onChange={set('name')} sanitize={(v) => sanitizeText(v, 80)} placeholder={t('company.name.ph')} />
          <TextField label={taxLabel} value={form.taxId} onChange={set('taxId')} maxLength={20} sanitize={sanitizeTaxId} placeholder={t(`company.taxId.ph.${region.code}`)} />
          <TextField label={t('company.phone')} value={form.phone} onChange={set('phone')} maxLength={24} sanitize={sanitizePhone} placeholder="+00 000 000 000" />
          <div>
            <TextField label={t('company.email')} value={form.email} onChange={set('email')} maxLength={120} sanitize={sanitizeEmailInput} placeholder="nombre@empresa.com" />
            {emailError && (
              <p role="alert" className="mt-1.5 text-sm font-semibold text-red-400">
                {t('company.emailInvalid')}
              </p>
            )}
          </div>
          <TextField label={t('company.city')} value={form.city} onChange={set('city')} maxLength={60} sanitize={(v) => sanitizeText(v, 60)} placeholder={t('company.city.ph')} />
        </div>

        <p className="mt-4 text-xs text-neutral-400">{t('company.privacy')}</p>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button type="submit">{t('company.save')}</Button>
        </div>
        <Button
          variant="danger"
          className="mt-3 w-full !min-h-[44px] text-sm"
          onClick={() => {
            setForm({ ...EMPTY_COMPANY });
            setEmailError(false);
          }}
        >
          {t('company.clear')}
        </Button>
      </form>
    </div>
  );
}
