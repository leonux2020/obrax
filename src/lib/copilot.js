// The brain behind the Copilot panel of CUBRAX Studio. A "reply function" is `(text, { t, lang, history }) => Promise<string>`: the panel only knows that
// contract, so the real agent (Gemini, called from the device with the user's own key, RAG over the local data of the job) replaces the echo below
// without touching a single component.

export const COPILOT_LIMITS = Object.freeze({
  inputChars: 500, // what one message may hold
  historyMessages: 100, // what the panel keeps on screen
  replyChars: 4000, // a reply is cut here (a runaway answer must never freeze the panel)
});

export const ECHO_DELAY_MS = 450; // a short, human pause: the "typing" dots are visible

/**
 * PLACEHOLDER agent (phase 2, step 1): repeats what was written with the prefix "Analizando..." after a short pause. Nothing leaves the device.
 * @param delayMs  pause before answering (tests use 0)
 */
export function createEchoCopilot({ delayMs = ECHO_DELAY_MS } = {}) {
  return async (text, { t }) => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return `${t('studio.chat.echo')} ${text}`;
  };
}

/** Whatever an agent returns, as safe plain text for the panel: a string, trimmed, bounded; anything else is an empty answer. */
export const cleanReply = (value) => (typeof value === 'string' ? value.trim().slice(0, COPILOT_LIMITS.replyChars) : '');
