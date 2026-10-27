import { useMemo, useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { LEDGER_LIMITS } from '../../lib/ledger.js';
import { sanitizeText } from '../../lib/sanitize.js';
import { PhotoError } from '../../lib/photos.js';
import { notePhotosFor, prepareNotePhoto } from '../../lib/notePhotos.js';
import { useDictation } from '../../lib/useDictation.js';
import Block from './Block.jsx';
import { NoteThumb, PhotoLightbox, useNotePhoto } from './NotePhoto.jsx';

const Icon = ({ children }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

/**
 * The text of one note, corrected (and its photo flag: true = has one, false = has none, undefined = unchanged).
 * Empty after cleaning = nothing to save (the notes stay as they were).
 */
export const editNote = (entries, id, raw, photo) => {
  const text = sanitizeText(raw, LEDGER_LIMITS.logChars).trim();
  if (!text) return entries;
  return entries.map((e) => {
    if (e.id !== id) return e;
    const { photo: had, ...rest } = e;
    const has = photo === undefined ? had === true : photo;
    return { ...rest, text, ...(has ? { photo: true } : {}) };
  });
};

/** One note of the list: text, the quiet icon buttons and, when it has one, the photo thumbnail. */
function NoteRow({ entry, store, editing, setEditing, onDelete, onOpenPhoto, onSave, stamp, saveError }) {
  const { t, lang, locale } = useI18n();
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [pickError, setPickError] = useState('');
  const stored = useNotePhoto(store, entry.id, entry.photo === true);
  const mine = editing?.id === entry.id;
  const textRef = useRef('');
  textRef.current = editing?.text ?? '';
  const mic = useDictation({
    lang,
    locale,
    getText: () => textRef.current,
    onText: (full) => setEditing((cur) => (cur && cur.id === entry.id ? { ...cur, text: sanitizeText(full, LEDGER_LIMITS.logChars) } : cur)),
  });
  const micIssue = mic.issue ? { denied: 'log.dictateDenied', unsupported: 'log.dictateUnsupported', network: 'log.dictateNetwork' }[mic.issue] || 'log.dictateError' : '';

  // what the editor shows: the stored photo, the new one, or none
  const shown = !mine ? stored : editing.photo === 'keep' ? stored : editing.photo === 'remove' ? null : editing.photo;

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPickError('');
    setBusy(true);
    try {
      const prepared = await prepareNotePhoto(file);
      setEditing((cur) => (cur && cur.id === entry.id ? { ...cur, photo: prepared } : cur));
    } catch (err) {
      setPickError(err instanceof PhotoError ? `photo.err.${err.code}` : 'photo.err.store');
    } finally {
      setBusy(false);
    }
  };
  const finish = (fn) => () => {
    mic.stop();
    fn();
  };

  return (
    <li className="py-3 first:pt-0 last:pb-0" data-testid="wlog-note" data-id={entry.id}>
      <div className="flex items-center gap-1">
        <p className="min-w-0 flex-1 truncate text-xs font-semibold text-[#E0E0E0]/60">{stamp(entry.at)}</p>
        {!mine && (
          <>
            <button
              type="button"
              onClick={() => setEditing({ id: entry.id, text: entry.text, photo: 'keep' })}
              aria-label={`${t('ws.log.edit')}: ${stamp(entry.at)}`}
              data-testid={`wlog-edit-${entry.id}`}
              className="flex h-11 w-11 shrink-0 items-center justify-center text-[#E0E0E0]/50 active:text-[#E0E0E0]"
            >
              <Icon>
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </Icon>
            </button>
            <button
              type="button"
              onClick={() => onDelete(entry)}
              aria-label={`${t('common.delete')}: ${stamp(entry.at)}`}
              data-testid={`wlog-del-${entry.id}`}
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

      {mine ? (
        <div className="mt-1 space-y-2">
          <div className="relative">
            <textarea
              value={editing.text}
              onChange={(ev) => setEditing({ ...editing, text: sanitizeText(ev.target.value, LEDGER_LIMITS.logChars) })}
              readOnly={mic.listening}
              rows={4}
              lang={lang}
              autoCapitalize="sentences"
              spellCheck
              aria-label={t('ws.log.edit')}
              data-testid="wlog-input"
              className="field-input min-h-[112px] resize-y pr-14"
            />
            <button
              type="button"
              onClick={mic.toggle}
              aria-label={mic.listening ? t('log.dictate.stop') : t('log.dictate')}
              aria-pressed={mic.listening}
              data-testid="wlog-mic"
              data-listening={mic.listening ? 'true' : 'false'}
              className={`absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full border text-xl leading-none transition active:scale-95 ${
                mic.listening ? 'animate-pulse border-red-500 bg-red-500 text-white' : 'border-white/15 text-[#E0E0E0] hover:border-brand'
              }`}
            >
              <span aria-hidden="true">🎙️</span>
            </button>
          </div>
          {mic.listening && (
            <p role="status" className="flex items-center gap-2 text-xs font-semibold text-red-400" data-testid="wlog-listening">
              <span aria-hidden="true" className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />
              {t('log.listening')}
            </p>
          )}
          {micIssue && (
            <p role="alert" className="rounded-xl border border-red-500/60 px-3 py-2 text-sm font-semibold text-red-400" data-testid="wlog-mic-issue">
              {t(micIssue)}
            </p>
          )}

          <div className="flex items-center gap-3">
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="wlog-photo-input" onChange={pick} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              data-testid="wlog-photo"
              className="flex min-h-[44px] min-w-[44px] items-center gap-2 rounded-xl border border-white/15 px-3 text-sm font-bold active:border-white/50 disabled:opacity-60"
            >
              <span aria-hidden="true" className="text-xl leading-none">
                📸
              </span>
              {busy ? t('ws.log.photoBusy') : shown ? t('ws.log.photoChange') : t('ws.log.photoAdd')}
            </button>
            {shown && (
              <>
                <NoteThumb photo={shown} label={t('ws.log.photoOpen')} onOpen={onOpenPhoto} testId="wlog-edit-thumb" />
                <button type="button" onClick={() => setEditing({ ...editing, photo: 'remove' })} aria-label={t('ws.log.photoRemove')} data-testid="wlog-photo-remove" className="flex h-11 w-11 items-center justify-center text-[#E0E0E0]/60 active:text-red-400">
                  ✕
                </button>
              </>
            )}
          </div>
          {(pickError || saveError) && (
            <p role="alert" className="text-sm font-semibold text-red-400" data-testid="wlog-error">
              {t(pickError || saveError)}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={finish(() => setEditing(null))} data-testid="wlog-cancel" className="min-h-[44px] rounded-xl border border-white/15 text-sm font-bold active:border-white/50">
              {t('common.cancel')}
            </button>
            <button type="button" onClick={finish(onSave)} disabled={!editing.text.trim() || busy} data-testid="wlog-save" className="min-h-[44px] rounded-xl border-2 border-brand text-sm font-extrabold text-brand disabled:opacity-40">
              {t('ws.log.save')}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-0.5 flex items-start gap-3">
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm" data-testid="wlog-text">
            {entry.text}
          </p>
          {entry.photo === true && <NoteThumb photo={stored} label={t('ws.log.photoOpen')} onOpen={onOpenPhoto} testId={`wlog-thumb-${entry.id}`} />}
        </div>
      )}
    </li>
  );
}

/**
 * ZONE B, "Bitácora de obra": the notes of the job (dictated from the dock's 🎙️ or typed), newest first, readable on site while
 * the project runs. Each note has two quiet icon buttons: edit (a plain textarea in place, with its own 🎙️ to dictate more and a
 * 📸 to add / change / remove the photo) and delete. A note with a photo shows a thumbnail that opens full screen. The photos are
 * Blobs in IndexedDB (notePhotos.js), never base64. Notes are not part of the quote, so the block stays usable while the quote is
 * locked. The parent opens it by itself when a new note arrives.
 */
export default function LogBlock({ entries, onChange, open, onToggle, projectId = '_' }) {
  const { t, locale } = useI18n();
  const store = useMemo(() => notePhotosFor(projectId), [projectId]);
  const [editing, setEditing] = useState(null); // { id, text, photo: 'keep' | 'remove' | { blob, width, height } }
  const [viewer, setViewer] = useState('');
  const [saveError, setSaveError] = useState('');
  const list = [...entries].sort((a, b) => b.at - a.at);
  const stamp = (ms) => (ms ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms)) : '');

  const save = async () => {
    if (!editing || !editing.text.trim()) return;
    setSaveError('');
    const { id, photo } = editing;
    try {
      if (photo === 'remove') await store.remove(id);
      else if (photo !== 'keep') await store.put(id, photo); // the Blob is on disk BEFORE the note says it has one
    } catch {
      setSaveError('photo.err.store');
      return;
    }
    onChange(editNote(entries, id, editing.text, photo === 'keep' ? undefined : photo !== 'remove'));
    setEditing(null);
  };
  const remove = (e) => {
    if (!window.confirm(t('ws.log.confirmDelete'))) return;
    onChange(entries.filter((x) => x.id !== e.id));
    if (e.photo) store.remove(e.id).catch(() => {});
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
            <NoteRow key={e.id} entry={e} store={store} editing={editing} setEditing={(v) => (setSaveError(''), setEditing(v))} onDelete={remove} onOpenPhoto={setViewer} onSave={save} stamp={stamp} saveError={editing?.id === e.id ? saveError : ''} />
          ))}
        </ul>
      )}
      {viewer && <PhotoLightbox url={viewer} onClose={() => setViewer('')} />}
    </Block>
  );
}
