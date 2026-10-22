import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { computeAll } from '../lib/engine.js';
import { pricingTime } from '../lib/signature.js';
import { Button } from './ui.jsx';
import StepStart from './steps/StepStart.jsx';
import StepDims from './steps/StepDims.jsx';
import StepPartidas from './steps/StepPartidas.jsx';
import StepPrices from './steps/StepPrices.jsx';
import StepFinance from './steps/StepFinance.jsx';
import StepReport from './steps/StepReport.jsx';

const STEPS = {
  quick: ['task', 'dims', 'prices', 'finance', 'report'],
  project: ['project', 'partidas', 'prices', 'finance', 'report'],
};

export default function Wizard({ projectId, draft, setDraft, photos, setPhotos, company, onEditCompany, onNewProject, onExit }) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  const [showErrors, setShowErrors] = useState(false);

  // A signed quote keeps the prices it was signed at (see pricingTime); otherwise live market prices.
  const priceTime = pricingTime(draft, now);
  const result = useMemo(() => computeAll(draft, priceTime), [draft, priceTime]);

  const steps = STEPS[draft.mode] ?? STEPS.quick;
  const step = draft.step;
  const maxReachable = result.valid ? 4 : 1;
  const go = (n) => {
    setShowErrors(false);
    setDraft((d) => ({ ...d, step: n }));
    window.scrollTo({ top: 0 });
  };

  // Safety net: a restored draft can never leave the user on a step whose data is invalid.
  useEffect(() => {
    if (step > 1 && !result.valid) setDraft((d) => ({ ...d, step: 1 }));
  }, [step, result.valid, setDraft]);

  const next = () => {
    if (step === 1 && !result.valid) return setShowErrors(true);
    return go(Math.min(4, step + 1));
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-3 pb-32 pt-4 sm:px-4">
      <nav aria-label={t('nav.progress')} className="no-print mb-5">
        <ol className="flex items-center gap-1 sm:gap-2">
          {steps.map((s, i) => {
            const done = i < step;
            const current = i === step;
            const locked = i > maxReachable;
            return (
              <li key={s} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => go(i)}
                  aria-current={current ? 'step' : undefined}
                  className={`flex h-11 w-11 items-center justify-center rounded-full border-2 text-base font-extrabold transition disabled:opacity-40 ${
                    current
                      ? 'border-brand bg-brand text-black'
                      : done
                        ? 'border-brand text-brand'
                        : 'border-neutral-700 text-neutral-300'
                  }`}
                >
                  {done ? '✓' : i + 1}
                </button>
                <span
                  className={`w-full truncate text-center text-[11px] font-semibold sm:text-sm ${
                    current ? 'text-white' : 'text-neutral-400'
                  }`}
                >
                  {t(`step.${s}`)}
                </span>
              </li>
            );
          })}
        </ol>
      </nav>

      {step === 0 && <StepStart draft={draft} setDraft={setDraft} photos={photos} setPhotos={setPhotos} projectId={projectId} />}
      {step === 1 && draft.mode === 'quick' && (
        <StepDims draft={draft} setDraft={setDraft} result={result} showErrors={showErrors} />
      )}
      {step === 1 && draft.mode === 'project' && (
        <StepPartidas draft={draft} setDraft={setDraft} result={result} showErrors={showErrors} />
      )}
      {step === 2 && (
        <StepPrices draft={draft} setDraft={setDraft} result={result} now={priceTime} onRefresh={() => setNow(Date.now())} />
      )}
      {step === 3 && <StepFinance draft={draft} setDraft={setDraft} result={result} />}
      {step === 4 && (
        <StepReport
          draft={draft}
          setDraft={setDraft}
          result={result}
          pricedAt={priceTime}
          photos={photos}
          company={company}
          onEditCompany={onEditCompany}
          onNewProject={onNewProject}
        />
      )}

      <div className="no-print fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-black px-3 py-3 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-5xl gap-3">
          <Button variant="ghost" onClick={() => (step === 0 ? onExit() : go(step - 1))} className="min-w-[110px]" data-testid="wizard-back">
            ← {t(step === 0 ? 'nav.projects' : 'common.back')}
          </Button>
          {step < 4 && (
            <Button className="flex-1" onClick={next}>
              {t('common.next')} →
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
