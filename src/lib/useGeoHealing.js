// SILENT HEALING of missing coordinates. A job (or a worker) typed by hand in an old record has a city NAME but no point, so its distance cannot
// be measured. While the omnibox is searching, the missing points are asked to the forward geocoder (Nominatim, see forwardGeocode.js) in the
// background, one at a time and gently, and the answers are merged into the objects the ranking reads (in MEMORY only: nothing is saved, nothing is
// shown, nothing blocks). Offline / any failure = no point: the worker stays listed as "distance unknown" (crewMatch.js), never hidden.

import { useEffect, useMemo, useRef, useState } from 'react';
import { hasPoint, omniMatch } from './crewMatch.js';
import { haversineKm } from './geoDistance.js';

export const HEAL_MAX_WORKERS = 10; // per search: the people the user is looking at, not the whole directory
export const HEAL_PAUSE_MS = 1100; // Nominatim asks for at most 1 request per second

const keyOf = (kind, text) => `${kind}:${String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ')}`;
const cityOf = (w) => String(w?.city ?? w?.ciudad ?? '').trim();
const jobText = (project) => String(project?.cityOrRegion || project?.location?.label || '').trim();

/** The answer that best describes `text`: the nearest one to the job when its point is known (so "Maipú" is the one near the job), else the job's country, else the first. */
export function pickPlace(places, { near = null, countryCode = '' } = {}) {
  const list = (Array.isArray(places) ? places : []).filter((p) => hasPoint(p));
  if (!list.length) return null;
  if (near && hasPoint(near)) {
    return [...list].sort((a, b) => haversineKm({ lat: near.lat, lng: near.lng ?? near.lon }, a) - haversineKm({ lat: near.lat, lng: near.lng ?? near.lon }, b))[0];
  }
  return list.find((p) => countryCode && p.countryCode === countryCode) ?? list[0];
}

/** What is missing: the job's point (first) and the points of the workers the search is showing. [{ key, text, kind }] */
export function healTargets({ project, directory, query }) {
  const out = [];
  const text = jobText(project);
  if (text && !hasPoint(project?.location)) out.push({ key: keyOf('p', text), text, kind: 'project' });
  const seen = new Set();
  for (const w of Array.isArray(directory) ? directory : []) {
    const city = cityOf(w);
    if (!city || hasPoint({ lat: w.lat, lng: w.lon ?? w.lng })) continue;
    if (query && !omniMatch(query, [w.name, w.apodo])) continue; // only the people the typed text is finding (a trade word can only add more, cheaply)
    const key = keyOf('w', city);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, text: city, kind: 'worker' });
    if (seen.size >= HEAL_MAX_WORKERS) break;
  }
  return out;
}

/**
 * `geocode(text, { lang, signal })` -> places [{ lat, lng, countryCode }] (searchPlaces) or null = healing off. Returns the project and the directory
 * with the points found so far merged in (the same objects when nothing was found).
 */
export function useGeoHealing({ enabled, geocode, project, directory, query, lang = '', pauseMs = HEAL_PAUSE_MS }) {
  const [points, setPoints] = useState({}); // key -> { lat, lng }
  const tried = useRef(new Set());
  const targets = useMemo(() => (enabled && geocode ? healTargets({ project, directory, query }) : []), [enabled, geocode, project, directory, query]);
  const todo = targets.filter((t) => !tried.current.has(t.key));
  const signature = todo.map((t) => t.key).join('|');

  useEffect(() => {
    if (!signature || !geocode) return undefined;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    let dead = false;
    (async () => {
      let jobPoint = hasPoint(project?.location) ? project.location : null;
      for (let i = 0; i < todo.length && !dead; i += 1) {
        const target = todo[i];
        let places = [];
        try {
          places = (await geocode(target.text, { lang, signal: ctl?.signal })) || [];
        } catch {
          places = [];
        }
        if (dead) return;
        tried.current.add(target.key);
        const best = pickPlace(places, { near: target.kind === 'worker' ? jobPoint : null, countryCode: project?.draft?.regionCode || '' });
        if (best) {
          const point = { lat: best.lat, lng: best.lng };
          if (target.kind === 'project') jobPoint = point;
          setPoints((cur) => ({ ...cur, [target.key]: point }));
        }
        if (pauseMs > 0 && i < todo.length - 1) await new Promise((r) => setTimeout(r, pauseMs));
      }
    })();
    return () => {
      dead = true;
      ctl?.abort();
    };
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const healedProject = useMemo(() => {
    const text = jobText(project);
    const pt = text && !hasPoint(project?.location) ? points[keyOf('p', text)] : null;
    return pt ? { ...project, location: { lat: pt.lat, lng: pt.lng, label: project?.location?.label || '' } } : project;
  }, [project, points]);
  const healedDirectory = useMemo(() => {
    if (!Object.keys(points).length) return directory;
    return directory.map((w) => {
      const pt = !hasPoint({ lat: w.lat, lng: w.lon ?? w.lng }) ? points[keyOf('w', cityOf(w))] : null;
      return pt ? { ...w, lat: pt.lat, lon: pt.lng } : w;
    });
  }, [directory, points]);

  return { project: healedProject, directory: healedDirectory };
}
