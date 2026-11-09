import { useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { GEMINI_KEY_URL, clearGeminiKey, maskGeminiKey, setGeminiKey, useGeminiKey } from '../lib/geminiKey.js';
import BottomSheet from './BottomSheet.jsx';

/**
 * BYOK field: the user's own Google AI Studio key, kept only on this device (lib/geminiKey.js). Silent by default: a password field
 * (never shown back whole: once saved only "••••abcd" remains) with a quiet save, and the link to create a free key.
 * It lives in Ajustes (Operaciones y sincronización) and, when someone opens "Escanear Boleta con IA" without a key, inside GeminiKeySheet.
 */
export function GeminiKeyField({ onSaved, autoFocus = false, testId = 'gemini-key' }) {
  const { t } = useI18n();
  const saved = useGeminiKey();
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);

  const save = (e) => {
    e?.preventDefault?.();
    if (!draft.trim()) return;
    const key = setGeminiKey(draft);
    if (!key) {
      setInvalid(true);
      return;
    }
    setDraft('');
    setInvalid(false);
    onSaved?.(key);
  };

  return (
    <div className="space-y-3" data-testid={testId} data-state={saved ? 'saved' : 'empty'}>
      {saved ? (
        <div className="flex min-h-[48px] items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-base font-light text-neutral-300" data-testid={`${testId}-saved`} role="status">
            {t('gemini.saved')} <span className="text-neutral-400">{maskGeminiKey(saved)}</span>
          </p>
          <button
            type="button"
            onClick={clearGeminiKey}
            data-testid={`${testId}-remove`}
            className="min-h-[44px] rounded-xl px-3 text-sm font-light text-red-400/90 transition active:scale-95 active:opacity-70"
          >
            {t('gemini.remove')}
          </button>
        </div>
      ) : (
        <form onSubmit={save} className="flex items-center gap-2" autoComplete="off">
          <input
            type="password"
            name="gemini-api-key"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setInvalid(false);
            }}
            placeholder={t('gemini.placeholder')}
            aria-label={t('gemini.field')}
            aria-invalid={invalid || undefined}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            autoFocus={autoFocus}
            data-lpignore="true"
            data-1p-ignore="true"
            data-testid={`${testId}-input`}
            className="min-h-[48px] min-w-0 flex-1 rounded-xl bg-white/5 px-4 text-base font-light text-neutral-200 placeholder:text-neutral-500"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            data-testid={`${testId}-save`}
            className="min-h-[48px] rounded-xl px-4 text-base font-light text-brand/90 transition active:scale-95 active:opacity-70 disabled:pointer-events-none disabled:opacity-30"
          >
            {t('gemini.save')}
          </button>
        </form>
      )}
      {invalid && (
        <p className="text-xs font-light text-red-400/90" role="alert" data-testid={`${testId}-invalid`}>
          {t('gemini.invalid')}
        </p>
      )}
      {!saved && <p className="text-xs font-light leading-snug text-neutral-400">{t('gemini.hint')}</p>}
      {!saved && (
        <a
          href={GEMINI_KEY_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={`${testId}-link`}
          className="inline-flex min-h-[44px] items-center text-sm font-light text-brand/90 transition active:scale-95 active:opacity-70"
        >
          {t('gemini.get')}
        </a>
      )}
    </div>
  );
}

/** The soft modal asked when AI reading is opened without a key: what it is, the field and the link to create one for free. */
export function GeminiKeySheet({ onClose, onSaved }) {
  const { t } = useI18n();
  return (
    <BottomSheet title={t('gemini.sheet.title')} onClose={onClose} dock>
      <div className="mt-2 space-y-5" data-testid="gemini-key-sheet">
        <p className="text-base font-light leading-snug text-neutral-300">{t('gemini.sheet.body')}</p>
        <GeminiKeyField onSaved={onSaved} autoFocus testId="gemini-sheet-key" />
      </div>
    </BottomSheet>
  );
}

/**
 * Renders `children` (the AI feature) only when this device has a key; otherwise the soft key sheet. Saving the key swaps it for the
 * feature in place; closing the sheet closes the feature (`onClose`).
 */
export function KeyGate({ onClose, children }) {
  const key = useGeminiKey();
  return key ? children : <GeminiKeySheet onClose={onClose} />;
}
