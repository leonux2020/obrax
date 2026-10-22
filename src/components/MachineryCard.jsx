import { useI18n } from '../lib/i18n.jsx';
import { MACHINE_IDS } from '../lib/machinery.js';
import { Switch } from './ui.jsx';

/** Major machinery rental: suggested by the engine, added as an indirect cost, switchable per machine. */
export default function MachineryCard({ draft, setDraft, result }) {
  const { t, money, num } = useI18n();
  const m = result.machinery;
  const config = draft.machinery ?? { include: true, excluded: [] };
  const set = (patch) => setDraft((d) => ({ ...d, machinery: { ...(d.machinery ?? { include: true, excluded: [] }), ...patch } }));
  const toggle = (id, on) => {
    const ex = new Set(config.excluded);
    if (on) ex.delete(id);
    else ex.add(id);
    set({ excluded: MACHINE_IDS.filter((x) => ex.has(x)) });
  };

  // One row per machine type (a scaffold used in two partidas is a single switch).
  const groups = MACHINE_IDS.map((id) => {
    const items = m.items.filter((i) => i.id === id);
    return items.length ? { id, items, total: items.reduce((s, i) => s + i.total, 0) } : null;
  }).filter(Boolean);

  return (
    <section aria-labelledby="mach-title" className="space-y-3" data-testid="machinery-card">
      <div>
        <h3 id="mach-title" className="text-lg font-bold">
          {t('mach.title')}
        </h3>
        <p className="text-sm text-neutral-300">{t('mach.desc')}</p>
      </div>

      {groups.length === 0 ? (
        <p className="card text-neutral-300">{t('mach.none')}</p>
      ) : (
        <>
          <Switch
            data-testid="machinery-master"
            checked={config.include}
            onChange={(include) => set({ include })}
            label={t('mach.include')}
            description={t('mach.include.desc')}
          />
          {config.include &&
            groups.map((g) => (
              <Switch
                key={g.id}
                data-testid={`machinery-${g.id}`}
                checked={!config.excluded.includes(g.id)}
                onChange={(on) => toggle(g.id, on)}
                label={`${t(`mach.${g.id}`)} · ${money(g.total)}`}
                description={`${t(`mach.why.${g.id}`)} ${g.items.map((i) => t('mach.line', { qty: num(i.qty, 0), days: num(i.days, 0), rate: money(i.rate) })).join(' + ')}`}
              />
            ))}
        </>
      )}
      <p className="text-xs text-neutral-400">{t('mach.nohand')}</p>
    </section>
  );
}
