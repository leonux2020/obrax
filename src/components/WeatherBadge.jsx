import { useI18n } from '../lib/i18n.jsx';
import { windDisplay } from '../lib/weatherService.js';

const Svg = ({ children, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-outline-icon="true">
    {children}
  </svg>
);

const CLOUD = 'M7 18a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 9.5a4 4 0 0 1 .5 8.5H7z';

// Semantic palette for the OLED: each layer of an icon carries its own colour (a <g> with a text-* class; the strokes are `currentColor`),
// so the sky is read at a glance from the corner of the eye: sun = yellow, cloud = grey, rain = blue, lightning = yellow, snow = pale sky.
const SUN = 'text-yellow-400';
const GREY = 'text-neutral-300';
const RAIN = 'text-blue-400';
const SNOW = 'text-sky-200';
const MOON = 'text-amber-200';

const Sun = ({ cx = 12, cy = 12, r = 4, rays }) => (
  <g className={SUN}>
    <circle cx={cx} cy={cy} r={r} />
    <path d={rays} />
  </g>
);

/** Colour outline icon of the sky: sun / moon (clear), sun behind a cloud, cloud, fog, rain, snowflake, storm. */
export function SkyIcon({ sky, night = false }) {
  switch (sky) {
    case 'clear':
      return night ? (
        <Svg>
          <path className={MOON} d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
        </Svg>
      ) : (
        <Svg>
          <Sun rays="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
        </Svg>
      );
    case 'partly':
      return (
        <Svg>
          <Sun cx={8.5} cy={8.5} r={3} rays="M8.5 2v1.5M2 8.5h1.5M3.9 3.9l1 1M13.1 3.9l-1 1M3.9 13.1l1-1" />
          <path className={GREY} d={CLOUD} fill="#000" transform="translate(4.5 5) scale(0.72)" />
        </Svg>
      );
    case 'fog':
      return (
        <Svg>
          <path className="text-neutral-400" d="M4 9h16M3 13h14M6 17h14" />
        </Svg>
      );
    case 'rain':
      return (
        <Svg>
          <path className={GREY} d={CLOUD} transform="translate(0 -3)" />
          <path className={RAIN} d="M9 18l-1 3M13 18l-1 3M17 18l-1 3" />
        </Svg>
      );
    case 'snow':
      return (
        <Svg>
          <g className={SNOW}>
            <path d="M12 2.5v19M3.8 7.25l16.4 9.5M3.8 16.75l16.4-9.5" />
            <path d="M9.5 4.2L12 6.2l2.5-2M9.5 19.8L12 17.8l2.5 2" />
          </g>
        </Svg>
      );
    case 'storm':
      return (
        <Svg>
          <path className={GREY} d={CLOUD} transform="translate(0 -3)" />
          <path className="text-yellow-400" d="M12.5 15l-2.5 3.5h3L11 22" />
        </Svg>
      );
    default:
      return (
        <Svg>
          <path className={GREY} d={CLOUD} />
        </Svg>
      );
  }
}

export const WindIcon = () => (
  <Svg>
    <path d="M3 8h10a2.5 2.5 0 1 0-2.5-2.5" />
    <path d="M3 12h15a2.5 2.5 0 1 1-2.5 2.5" />
    <path d="M3 16h7a2 2 0 1 1-2 2" />
  </Svg>
);

/**
 * Compact read-only weather of a project card: sky icon + temperature, and a wind warning ONLY above the risk threshold (30 km/h, shown in
 * mph in the US / UK). Not a button, not focusable: the whole card stays the one tap target. It fades in when the reading lands.
 */
export default function WeatherBadge({ wx, regionCode = '' }) {
  const { t } = useI18n();
  if (!wx) return null;
  const temp = Math.round(wx.temp);
  const wind = wx.windAlert ? windDisplay(wx.wind, regionCode) : null;
  const windText = wind ? t('wx.wind', { speed: wind.value, unit: wind.unit }) : '';
  const skyText = wx.sky ? t('wx.card', { sky: t(`wx.sky.${wx.sky}`), temp }) : t('wx.ok', { temp });
  return (
    <span className="wx-in flex shrink-0 flex-col items-end gap-1" data-testid="card-weather" data-sky={wx.sky || ''} data-wind={wind ? 'alert' : 'ok'} title={[skyText, windText].filter(Boolean).join(' · ')}>
      <span className="flex items-center gap-1.5 text-sm tabular-nums text-neutral-300" role="img" aria-label={skyText} data-testid="card-weather-temp">
        <SkyIcon sky={wx.sky} night={wx.night} />
        {temp}°
      </span>
      {wind && (
        <span className="flex items-center gap-1 text-xs font-medium tabular-nums text-orange-400" role="img" aria-label={windText} data-testid="card-weather-wind">
          <WindIcon />
          {wind.value} {wind.unit}
        </span>
      )}
    </span>
  );
}
