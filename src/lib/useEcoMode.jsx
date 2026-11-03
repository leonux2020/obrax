import { createContext, useContext, useEffect, useState } from 'react';

// Eco-OLED mode: when the battery falls to 20 % (and the phone is not plugged in) every animation and transition is switched off
// (the CSS rule lives in index.css under `body.eco-mode`), so the phone survives the whole day on site. Zero configuration, zero
// messages. navigator.getBattery() does not exist on every browser (Safari / Firefox): there the mode simply never turns on.

export const ECO_LEVEL = 0.2;
export const ECO_CLASS = 'eco-mode';

/** Pure rule: low battery and not charging. */
export const isEcoBattery = (b) => Boolean(b) && typeof b.level === 'number' && Number.isFinite(b.level) && b.level <= ECO_LEVEL && b.charging === false;

export const EcoContext = createContext(false);
/** true while the Eco-OLED mode is on (components that run JS animations can look at it too). */
export const useEcoMode = () => useContext(EcoContext);

/** Watches the battery; returns `isEcoMode` and keeps the `eco-mode` class of <body> in sync. */
export function useEcoBattery({ nav = typeof navigator === 'undefined' ? null : navigator, doc = typeof document === 'undefined' ? null : document } = {}) {
  const [isEcoMode, setEco] = useState(false);

  useEffect(() => {
    if (!nav || typeof nav.getBattery !== 'function') return undefined;
    let alive = true;
    let battery = null;
    const update = () => alive && battery && setEco(isEcoBattery(battery));
    Promise.resolve()
      .then(() => nav.getBattery())
      .then((b) => {
        if (!alive || !b) return;
        battery = b;
        update();
        b.addEventListener?.('levelchange', update);
        b.addEventListener?.('chargingchange', update);
      })
      .catch(() => {}); // blocked by a permissions policy: no eco mode, no error
    return () => {
      alive = false;
      battery?.removeEventListener?.('levelchange', update);
      battery?.removeEventListener?.('chargingchange', update);
    };
  }, [nav]);

  useEffect(() => {
    const cl = doc?.body?.classList;
    if (!cl) return undefined;
    cl.toggle(ECO_CLASS, isEcoMode);
    return () => cl.remove(ECO_CLASS);
  }, [isEcoMode, doc]);

  return isEcoMode;
}
