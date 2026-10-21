import { useI18n } from '../../lib/i18n.jsx';
import DimsForm from '../DimsForm.jsx';

/** Quick mode: measurements of the single partida + live geometric preview. */
export default function StepDims({ draft, setDraft, result, showErrors }) {
  const { t, num, unit } = useI18n();
  const partida = draft.partidas[0];
  const computed = result.partidas[0];

  const setDims = (patch) =>
    setDraft((d) => ({ ...d, partidas: [{ ...d.partidas[0], dims: { ...d.partidas[0].dims, ...patch } }] }));

  return (
    <section aria-labelledby="dims-title" className="space-y-5">
      <div>
        <h2 id="dims-title" className="text-2xl font-bold">
          {t('dims.title')} · {t(`task.${partida.task}`)}
        </h2>
        <p className="text-neutral-300">{t('dims.hint')}</p>
      </div>

      <div className="card">
        <DimsForm partida={partida} validation={computed.validation} showErrors={showErrors} onChange={setDims} />
      </div>

      {computed.calc && (
        <div className="card border-brand/50" aria-live="polite">
          <h3 className="mb-3 text-lg font-bold text-brand">{t('dims.preview')}</h3>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {computed.calc.metrics.map((m) => (
              <div key={m.key}>
                <dt className="text-sm text-neutral-300">{t(`metric.${m.key}`)}</dt>
                <dd className="text-2xl font-extrabold tabular-nums">
                  {num(m.value, 3)} <span className="text-base font-semibold text-neutral-300">{unit(m.unit)}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
