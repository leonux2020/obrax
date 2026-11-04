import { useCallback, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import BottomSheet from './BottomSheet.jsx';
import { Button } from './ui.jsx';

/**
 * The app's own confirmation (it replaces every `window.confirm`): an OLED-black bottom sheet that rises like all the others, stays inside the
 * app (no system pop-up, nothing blocks the thread) and joins the back stack: the device Back, a swipe on the backdrop or Escape cancel it.
 * Cancel comes FIRST (it takes the initial focus: the safe answer is the default one); the confirming button is the destructive red unless
 * `danger={false}`.
 */
export default function ConfirmSheet({ message, confirmLabel, danger = true, onConfirm, onCancel, testId = 'confirm-sheet' }) {
  const { t } = useI18n();
  return (
    <BottomSheet title={t('confirm.title')} onClose={onCancel}>
      <div data-testid={testId} className="mt-2 space-y-5">
        <p className="text-base text-neutral-200" data-testid={`${testId}-message`}>
          {message}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={onCancel} data-testid={`${testId}-cancel`}>
            {t('common.cancel')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} data-testid={`${testId}-ok`}>
            {confirmLabel ?? t('common.yes')}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}

/**
 * `const [ask, confirmNode] = useConfirm();` render `{confirmNode}` once in the component and call
 * `ask({ message, confirmLabel, danger }, onYes)`: `onYes` runs only when the user confirms in the sheet.
 */
export function useConfirm() {
  const [req, setReq] = useState(null);
  const ask = useCallback((opts, onYes) => setReq({ ...opts, onYes }), []);
  const node = req ? (
    <ConfirmSheet
      message={req.message}
      confirmLabel={req.confirmLabel}
      danger={req.danger}
      onCancel={() => setReq(null)}
      onConfirm={() => {
        setReq(null);
        req.onYes();
      }}
    />
  ) : null;
  return [ask, node];
}
