import { useEffect, useRef } from 'react';
import { acquireLayer, releaseLayer } from './backStack.js';

/**
 * The accordions of a project (Parámetros, Diario, Anticipos, Gastos, Personal, each partida...) behave like menus for the device's Back:
 * opening one pushes a history entry (a back-stack layer: `pushState({ modalOpen: true })`, see backStack.js) and the Back press that comes
 * next only CLOSES it (the most recently opened first); it never throws the user out of the project. Closing it by hand (tapping its
 * header again, or the app opening / closing it by itself) silently drops the entry with a single history.back(), so the real history
 * stays in sync. Unmounting (leaving the project) releases every layer and removes the popstate listener of the stack's own.
 *
 * Accordions that are already open when the project appears (the first unfinished partida of a new project) are NOT layers: the first Back
 * must leave the project, not "close" something the user never opened. They become layers if they are closed and opened again.
 *
 * @param open     { [accordionId]: boolean }  the screen's open state
 * @param onClose  (accordionId) => void        closes that accordion (runs when the device's Back popped its entry)
 */
export function useAccordionBack(open, onClose) {
  const layers = useRef(new Map()); // accordion id -> back-stack layer id
  const initial = useRef(new Set(Object.keys(open).filter((id) => open[id])));
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const map = layers.current;
    for (const id of Object.keys(open)) {
      if (!open[id]) {
        initial.current.delete(id); // closed: from now on, opening it again makes it a layer
        continue;
      }
      if (initial.current.has(id) || map.has(id)) continue;
      map.set(
        id,
        acquireLayer(() => {
          map.delete(id); // Back took the entry
          close.current?.(id);
        })
      );
    }
    for (const [id, layer] of [...map]) {
      if (!open[id]) {
        map.delete(id);
        releaseLayer(layer); // closed by hand / by the app: drop its history entry
      }
    }
  }, [open]);

  useEffect(
    () => () => {
      for (const layer of layers.current.values()) releaseLayer(layer);
      layers.current.clear();
    },
    []
  );
}
