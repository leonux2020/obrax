import { useEffect, useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { fetchWeather, weatherPlace } from '../../lib/weather.js';
import { isHidden, onForeground } from '../../lib/foreground.js';

const Thermo = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z" />
  </svg>
);

/**
 * Passive thermal-prevention indicator of the project header: the temperature at the work site. Grey while it is comfortable, amber when it is
 * above 30 °C (hydrate, rotate the crew) or below 5 °C (cover up). It is not a button, it asks nothing and it never shows an error: with no
 * signal, no place or a failing API it renders NOTHING (see lib/weather.js: short timeout + a 2-hour localStorage cache).
 */
export default function WeatherChip({ project, regionCode = '', enabled = import.meta.env.MODE !== 'test', fetchImpl, storage, now }) {
  const { t } = useI18n();
  const [wx, setWx] = useState(null);
  const place = weatherPlace(project, regionCode);
  const key = place?.key || '';

  useEffect(() => {
    if (!enabled || !place) {
      setWx(null);
      return undefined;
    }
    let alive = true;
    const run = () => {
      if (isHidden()) return; // background: no request; the return to the foreground asks again (the 2-hour cache answers while it is fresh)
      const online = typeof navigator === 'undefined' || navigator.onLine !== false;
      const opts = { online };
      if (fetchImpl) opts.fetchImpl = fetchImpl;
      if (storage) opts.storage = storage;
      if (now !== undefined) opts.now = now;
      fetchWeather(place, opts).then((w) => alive && setWx(w));
    };
    run();
    const back = () => run(); // signal is back: try again (served from the cache while it is fresh)
    window.addEventListener('online', back);
    const offForeground = onForeground(run);
    return () => {
      alive = false;
      offForeground();
      window.removeEventListener('online', back);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  if (!wx || !wx.level) return null;
  const alert = wx.level !== 'ok';
  const temp = Math.round(wx.temp);
  const hint = t(`wx.${wx.level}`, { temp });
  return (
    <span
      role="img"
      aria-label={hint}
      title={hint}
      data-testid="ws-weather"
      data-level={wx.level}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium tabular-nums ${alert ? 'border-orange-500/50 bg-orange-500/10 text-orange-400' : 'border-white/10 text-neutral-400'}`}
    >
      <Thermo />
      {temp}°
    </span>
  );
}
