import { useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { sanitizeText } from '../../lib/sanitize.js';
import BottomSheet from '../BottomSheet.jsx';
import { TextField } from '../ui.jsx';

/**
 * ZONE C of a DRAFT (a job that is not in the database yet): the standard dock (Bitácora, Cámara, Boleta IA, Exportar) is replaced by two big actions.
 * SIMULAR / CALCULAR refreshes the big figures of the header from what was typed in the grid (nothing is saved); GUARDAR PROYECTO makes the job real.
 */
export default function DraftBar({ onSimulate, onSave }) {
  const { t } = useI18n();
  return (
    <nav aria-label={t('ws.dock')} data-testid="draft-bar" className="no-print fixed inset-x-0 bottom-0 z-30 bg-black [padding-bottom:env(safe-area-inset-bottom)]">
      <div className="mx-auto grid max-w-3xl grid-cols-2 gap-3 px-3 pb-3 pt-3">
        <button
          type="button"
          onClick={onSimulate}
          data-testid="draft-simulate"
          className="flex min-h-[56px] items-center justify-center rounded-2xl bg-white/5 px-3 text-sm font-medium uppercase text-neutral-200 transition active:scale-95 active:bg-white/10 active:opacity-70"
        >
          {t('ws.draft.simulate')}
        </button>
        <button
          type="button"
          onClick={onSave}
          data-testid="draft-save"
          className="flex min-h-[56px] items-center justify-center rounded-2xl bg-brand px-3 text-sm font-semibold uppercase text-black transition active:scale-95 active:opacity-70"
        >
          {t('ws.draft.save')}
        </button>
      </div>
    </nav>
  );
}

/** A soft modal that asks for the name when GUARDAR is tapped with none: one field, the keyboard-docked sheet, one big button. */
export function DraftNameSheet({ initial = '', onConfirm, onClose }) {
  const { t } = useI18n();
  const [name, setName] = useState(initial);
  const clean = sanitizeText(name, 60).trim();
  return (
    <BottomSheet title={t('ws.draft.nameTitle')} onClose={onClose} dock>
      <form
        className="mt-4 space-y-5 pb-2"
        data-testid="draft-name-sheet"
        onSubmit={(e) => {
          e.preventDefault();
          if (clean) onConfirm(clean);
        }}
      >
        <TextField label={t('project.name')} placeholder={t('project.namePh')} value={name} sanitize={(v) => sanitizeText(v, 60)} onChange={setName} testId="draft-name-input" />
        <button
          type="submit"
          disabled={!clean}
          data-testid="draft-name-confirm"
          className="flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-brand px-4 text-base font-semibold text-black transition active:scale-95 active:opacity-70 disabled:opacity-40"
        >
          {t('ws.draft.nameSave')}
        </button>
      </form>
    </BottomSheet>
  );
}

/** Device Back on a draft with data: three quiet choices instead of losing it. */
export function DraftLeaveSheet({ onKeep, onSave, onDiscard }) {
  const { t } = useI18n();
  return (
    <BottomSheet title={t('ws.draft.leaveTitle')} onClose={onKeep}>
      <div className="mt-4 space-y-3 pb-2" data-testid="draft-leave-sheet">
        <button type="button" onClick={onSave} data-testid="draft-leave-save" className="flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-brand px-4 text-base font-semibold text-black transition active:scale-95 active:opacity-70">
          {t('ws.draft.save')}
        </button>
        <button type="button" onClick={onKeep} data-testid="draft-leave-keep" className="flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-white/5 px-4 text-base text-neutral-200 transition active:scale-95 active:opacity-70">
          {t('ws.draft.keep')}
        </button>
        <button type="button" onClick={onDiscard} data-testid="draft-leave-discard" className="flex min-h-[56px] w-full items-center justify-center rounded-2xl px-4 text-base font-light text-red-400/90 transition active:scale-95 active:opacity-70">
          {t('ws.draft.discard')}
        </button>
      </div>
    </BottomSheet>
  );
}
