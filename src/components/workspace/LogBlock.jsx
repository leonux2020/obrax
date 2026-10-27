import { useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { LEDGER_LIMITS } from '../../lib/ledger.js';
import { sanitizeText } from '../../lib/sanitize.js';
import Block from './Block.jsx';

const Icon = ({ children }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

/** The text of one note, corrected. Empty after cleaning = nothing to save (the note stays as it was). */
export const editNote = (entries, id, raw) => {
  const text = sanitizeText(raw, LEDGER_LIMITS.logChars).trim();
  return text ? entries.map((e) => (e.id === id ? { ...e, text } : e)) : entries;
};

/**
 * ZONE B, "Bitácora de obra": the notes of the job (dictated from the dock's 🎙️ or typed), newest first, readable on site while
 * the project runs. Each note has two quiet icon buttons: edit (a plain textarea in place) and delete. The notes are not part of
 * the quote, so the block stays usable while the quote is locked. The parent opens it by itself when a new note arrives.
 */
export default function LogBlock({ entries, onChange, open, onToggle }) {
  const { t, lang, locale } = useI18n();
  const [editing, setEditing] = useState(null); // { id, text }
  const list = [...entries].sort((a, b) => b.at - a.at);
  const stamp = (ms) => (ms ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms)) : '');

  const save = () => {
    if (!editing) return;
    onChange(editNote(entries, editing.id, editing.text));
    setEditing(null);
  };
  const remove = (e) => {
    if (!window.confirm(t('ws.log.confirmDelete'))) return;
    onChange(entries.filter((x) => x.id !== e.id));
    if (editing?.id === e.id) setEditing(null);
  };

  return (
    <Block id="log" title={t('ws.log.title')} meta={entries.length ? String(entries.length) : ''} open={open} onToggle={onToggle} testId="ws-log">
      {list.length === 0 ? (
        <p className="text-sm text-[#E0E0E0]/60" data-testid="wlog-empty">
          {t('ws.log.empty')}
        </p>
      ) : (
        <ul className="divide-y divide-white/10" data-testid="wlog-list">
          {list.map((e) => (
            <li key={e.id} className="py-3 first:pt-0 last:pb-0" data-testid="wlog-note" data-id={e.id}>
              <div className="flex items-center gap-1">
                <p className="min-w-0 flex-1 truncate text-xs font-semibold text-[#E0E0E0]/60">{stamp(e.at)}</p>
                {editing?.id !== e.id && (
                  <>
                    <button
                      type="button"
                      onClick={() => setEditing({ id: e.id, text: e.text })}
                      aria-label={`${t('ws.log.edit')}: ${stamp(e.at)}`}
                      data-testid={`wlog-edit-${e.id}`}
                      className="flex h-11 w-11 shrink-0 items-center justify-center text-[#E0E0E0]/50 active:text-[#E0E0E0]"
                    >
                      <Icon>
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </Icon>
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(e)}
                      aria-label={`${t('common.delete')}: ${stamp(e.at)}`}
                      data-testid={`wlog-del-${e.id}`}
                      className="flex h-11 w-11 shrink-0 items-center justify-center text-[#E0E0E0]/50 active:text-red-400"
                    >
                      <Icon>
                        <path d="M4 7h16" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M6 7l1 13h10l1-13" />
                        <path d="M9 7V4h6v3" />
                      </Icon>
                    </button>
                  </>
                )}
              </div>
              {editing?.id === e.id ? (
                <div className="mt-1 space-y-2">
                  <textarea
                    value={editing.text}
                    onChange={(ev) => setEditing({ id: e.id, text: sanitizeText(ev.target.value, LEDGER_LIMITS.logChars) })}
                    rows={4}
                    lang={lang}
                    autoCapitalize="sentences"
                    spellCheck
                    aria-label={t('ws.log.edit')}
                    data-testid="wlog-input"
                    className="field-input min-h-[96px] resize-y"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setEditing(null)} data-testid="wlog-cancel" className="min-h-[44px] rounded-xl border border-white/15 text-sm font-bold active:border-white/50">
                      {t('common.cancel')}
                    </button>
                    <button type="button" onClick={save} disabled={!editing.text.trim()} data-testid="wlog-save" className="min-h-[44px] rounded-xl border-2 border-brand text-sm font-extrabold text-brand disabled:opacity-40">
                      {t('ws.log.save')}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm" data-testid="wlog-text">
                  {e.text}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}
