import { useI18n } from '../../lib/i18n.jsx';

/** The small birthday cake next to a name, only rendered on the day (see `isBirthdayToday`): a quiet nudge for the contractor to say happy birthday. */
export default function BirthdayMark({ testId = 'worker-birthday' }) {
  const { t } = useI18n();
  return (
    <span role="img" aria-label={t('squadra.birthday')} title={t('squadra.birthday')} data-testid={testId} className="shrink-0 text-base leading-none">
      🎂
    </span>
  );
}
