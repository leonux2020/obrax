import { useI18n } from '../../lib/i18n.jsx';
import { MapPinIcon, Outline } from '../workspace/icons.jsx';
import { nameParts } from '../workspace/CrewSuggest.jsx';
import Nick from './Nick.jsx';
import { Stars } from './Stars.jsx';
import WorkerLedger from './WorkerLedger.jsx';

const PhoneIcon = (props) => (
  <Outline icon="phone" {...props}>
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
  </Outline>
);
const MailIcon = (props) => (
  <Outline icon="mail" {...props}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </Outline>
);

/** The name as the large identity line: `Juan “El Flaco” Pérez`. Also used as the title of the sheet in read mode. */
export function IdentityName({ worker }) {
  const { first, rest } = nameParts(worker.name);
  return (
    <span data-testid="worker-card-name" className="text-xl text-neutral-100">
      {first}
      <Nick apodo={worker.apodo} testId="worker-card-apodo" />
      {rest && ` ${rest}`}
    </span>
  );
}

/** One line of the contact block: a quiet icon instead of a label (the label stays for screen readers), the text beside it. A missing value renders nothing. */
function Line({ icon, label, children, testId }) {
  if (!children) return null;
  return (
    <p className="flex items-start gap-3 text-base text-neutral-200" data-testid={testId}>
      <span role="img" aria-label={label} title={label} className="mt-0.5 shrink-0 text-neutral-500">
        {icon}
      </span>
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

/**
 * READ-ONLY file of a worker ("Zero Stress"): no inputs, no boxes and no lines, only type hierarchy and spacing on the black ground.
 * Identity (the name is the title of the sheet) -> trades in the accent colour -> contact and place (icons instead of labels) -> the quiet
 * personal line -> safety and health (the part that must never be lost, orange, without a frame) -> the financial history at the bottom.
 * Every empty field disappears (no "N/A", no blank slot).
 */
export default function WorkerCard({ worker, projects }) {
  const { t } = useI18n();
  const trades = (worker.specialties ?? []).map((id) => t(`ws.spec.${id}`));
  const place = [worker.address, worker.city].map((s) => String(s ?? '').trim()).filter(Boolean).join(', ');
  const personal = [worker.document, worker.nationality, worker.sex ? t(`squadra.sex.${worker.sex}`) : '', worker.birthDate].map((s) => String(s ?? '').trim()).filter(Boolean);
  const hasContact = Boolean(worker.phone || worker.email || place);
  const hasSafety = Boolean(worker.bloodType || worker.limiting || worker.allergies || worker.emergencyName || worker.emergencyPhone);
  return (
    <div data-testid="worker-card" className="space-y-6">
      {(trades.length > 0 || worker.rating > 0) && (
        <div className="space-y-2" data-testid="worker-card-trade">
          {trades.length > 0 && (
            <p className="text-base font-medium text-brand/90" data-testid="worker-card-specialties">
              {trades.join(' · ')}
            </p>
          )}
          {worker.rating > 0 && <Stars value={worker.rating} size={16} />}
        </div>
      )}

      {hasContact && (
        <div className="space-y-3" data-testid="worker-card-contact">
          <Line icon={<PhoneIcon size={20} />} label={t('squadra.phone')} testId="worker-card-phone">
            {worker.phone && <a href={`tel:${String(worker.phone).replace(/[^\d+]/g, '')}`}>{worker.phone}</a>}
          </Line>
          <Line icon={<MailIcon size={20} />} label={t('squadra.email')} testId="worker-card-email">
            {worker.email && <a href={`mailto:${worker.email}`}>{worker.email}</a>}
          </Line>
          <Line icon={<MapPinIcon size={20} />} label={t('squadra.address')} testId="worker-card-place">
            {place}
          </Line>
        </div>
      )}

      {personal.length > 0 && (
        <p className="text-sm tabular-nums text-neutral-400" data-testid="worker-card-personal">
          {personal.join(' · ')}
        </p>
      )}

      {hasSafety && (
        <div className="space-y-2" data-testid="worker-card-safety">
          <h3 className="text-sm font-medium text-orange-300">{t('squadra.safety')}</h3>
          {worker.bloodType && (
            <p className="text-base font-medium tabular-nums text-red-400" data-testid="worker-card-blood">
              {worker.bloodType}
            </p>
          )}
          {worker.limiting && (
            <p className="text-base text-neutral-200" data-testid="worker-card-limiting">
              <span className="block text-xs text-neutral-400">{t('squadra.limiting')}</span>
              {worker.limiting}
            </p>
          )}
          {worker.allergies && (
            <p className="text-base text-neutral-200" data-testid="worker-card-allergies">
              <span className="block text-xs text-neutral-400">{t('squadra.allergies')}</span>
              {worker.allergies}
            </p>
          )}
          {(worker.emergencyName || worker.emergencyPhone) && (
            <p className="text-base text-neutral-200" data-testid="worker-card-emergency">
              <span className="block text-xs text-neutral-400">{t('squadra.emName')}</span>
              {[worker.emergencyName, worker.emergencyPhone].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      )}

      <WorkerLedger workerId={worker.id} projects={projects} flat />
    </div>
  );
}
