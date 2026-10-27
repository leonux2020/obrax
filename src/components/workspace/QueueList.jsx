import { useI18n } from '../../lib/i18n.jsx';

const TONE = { pending: '#E0E0E0', sending: '#E0E0E0', review: '#ff9500', failed: '#ff2b2b' };

/** Receipts of this project waiting in the deferred queue, with what the user can do about each one. */
export default function QueueList({ rows, onRetry, onDiscard, onAccept }) {
  const { t, locale } = useI18n();
  if (!rows.length) return null;
  const when = (ms) => (ms ? new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms)) : '');
  const label = (r) => (r.status === 'failed' ? t('q.state.failed') : r.status === 'review' ? t('q.state.review') : r.status === 'sending' ? t('q.sending') : t('q.pending'));
  const btn = 'min-h-[44px] rounded-lg border border-white/15 px-3 text-xs font-bold active:border-white/50';
  return (
    <ul className="mb-3 space-y-2" data-testid="queue-list" aria-label={t('q.title')}>
      {rows.map((r) => (
        <li key={r.id} data-testid={`queued-${r.id}`} data-status={r.status} style={{ borderLeftColor: TONE[r.status] }} className="rounded-xl border border-l-2 border-white/10 px-3 py-2">
          <p style={{ color: TONE[r.status] }} className="text-sm font-bold">
            🧾 {label(r)}
          </p>
          <p className="text-xs text-[#E0E0E0]/60">{when(r.createdAt)}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {r.status === 'review' && (
              <button type="button" className={btn} onClick={() => onAccept(r.id)} data-testid={`queued-accept-${r.id}`}>
                {t('q.act.accept')}
              </button>
            )}
            {(r.status === 'failed' || r.status === 'pending') && (
              <button type="button" className={btn} onClick={() => onRetry(r.id)} data-testid={`queued-retry-${r.id}`}>
                {t('q.act.retry')}
              </button>
            )}
            <button type="button" className={`${btn} text-red-400`} onClick={() => onDiscard(r.id)} data-testid={`queued-discard-${r.id}`}>
              {t('q.act.discard')}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
