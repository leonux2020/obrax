import { useEffect, useRef, useState } from 'react';
import { createDictation, getSpeechRecognition } from './speech.js';

/**
 * One dictation into an existing text field (e.g. editing a logbook note). Same clean engine as the logbook capture
 * (createDictation: continuous=false, interimResults=false): what is said is appended to the text already there, with a
 * single space between. `getText()` gives the current text; `onText(full)` receives it with the new words.
 * Returns { supported, listening, issue, toggle, stop }; `issue` is '' | 'denied' | 'unsupported' | 'network' | 'error'.
 */
export function useDictation({ lang, locale, getText, onText }) {
  const [listening, setListening] = useState(false);
  const [issue, setIssue] = useState('');
  const session = useRef(null);
  const live = useRef({ getText, onText });
  live.current = { getText, onText };

  const stop = () => session.current?.stop();
  const toggle = () => {
    if (listening) return stop();
    if (!getSpeechRecognition()) {
      setIssue('unsupported');
      return undefined;
    }
    setIssue('');
    session.current = createDictation({
      lang,
      locale,
      getBase: () => live.current.getText(),
      onText: (full) => live.current.onText(full),
      onEnd: (full) => {
        live.current.onText(full);
        setListening(false);
      },
      onError: (kind) => {
        setListening(false);
        setIssue(kind);
      },
    });
    if (session.current.start()) setListening(true);
    return undefined;
  };
  useEffect(() => () => session.current?.stop(), []);
  return { supported: Boolean(getSpeechRecognition()), listening, issue, toggle, stop };
}
