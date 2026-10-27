import { useMemo, useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n.jsx';
import { SUPPLIER_RADIUS_KM, getCurrentCoords, haversineKm, normalizeCoords } from '../../lib/geoDistance.js';
import { saveUserPrice } from '../../lib/priceFeed.js';
import { suggestSuppliers } from '../../lib/suppliers.js';
import { useSuppliers } from '../../lib/usePrices.js';
import NumberPad from './NumberPad.jsx';
import SupplierBar from './SupplierBar.jsx';

/**
 * A price numpad that also says WHERE the price comes from ("Radar de Mercado"). It is the NumberPad plus the supplier tags;
 * every typed value goes to the user's price book through saveUserPrice (and `onApply`, e.g. this project's own price).
 *
 *   - No supplier chosen: exactly the old behaviour (the user's standard price on this device).
 *   - Supplier chosen: the price is saved WITH its name and place. The place is the project's coordinates at once (no waiting)
 *     and, if the phone gives a GPS fix (permission granted, within the project's radius), the fix replaces them a moment
 *     later. Denied / no GPS: the project's coordinates stay, nothing is asked again and nothing blocks.
 *
 * Mount it with a `key` per target: the supplier choice lives as long as the pad is open.
 */
export default function SupplierPad({ regionCode, kind, itemId, projectLocation = null, initialSupplier = '', onApply = null, foot = '', onReset = null, onClose, ...pad }) {
  const { t } = useI18n();
  const entries = useSuppliers(regionCode);
  const [name, setName] = useState(initialSupplier);
  const nameRef = useRef(initialSupplier);
  const lastRef = useRef(null); // last number typed in this session
  const usedRef = useRef(normalizeCoords(projectLocation)); // coordinates the price is saved at
  const gpsRef = useRef(false);
  const project = normalizeCoords(projectLocation);
  const suggestions = useMemo(() => suggestSuppliers({ regionCode, entries }), [regionCode, entries]);

  const persist = (n, replaces) => {
    if (!nameRef.current) {
      saveUserPrice(regionCode, kind, itemId, n, { near: project });
      return;
    }
    saveUserPrice(regionCode, kind, itemId, n, { supplier: { name: nameRef.current, ...(usedRef.current || {}), ...(replaces ? { replaces } : {}) } });
  };

  const locate = () => {
    if (gpsRef.current) return;
    gpsRef.current = true;
    getCurrentCoords().then((fix) => {
      if (!fix || (project && haversineKm(project, fix) > SUPPLIER_RADIUS_KM)) return; // a fix far from the job is not where the job's supplier is
      const before = usedRef.current;
      usedRef.current = fix;
      if (nameRef.current && lastRef.current > 0) persist(lastRef.current, before && (before.lat !== fix.lat || before.lng !== fix.lng) ? before : null);
    });
  };

  const change = (n) => {
    lastRef.current = n;
    onApply?.(n);
    persist(n);
    if (nameRef.current) locate();
  };
  const choose = (next) => {
    nameRef.current = next;
    setName(next);
    if (next) locate();
    if (lastRef.current > 0) persist(lastRef.current); // the number already typed is now that supplier's
  };

  return (
    <NumberPad
      {...pad}
      foot={name ? t('ws.supplier.saveAt', { name }) : foot}
      top={<SupplierBar suggestions={suggestions} value={name} onSelect={choose} onAdd={choose} />}
      onChange={change}
      onReset={() => {
        lastRef.current = null;
        onApply?.(null);
        persist(null);
        onReset?.();
      }}
      onClose={onClose}
    />
  );
}
