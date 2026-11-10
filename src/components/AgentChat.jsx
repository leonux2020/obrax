import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.jsx';
import { COPILOT_LIMITS, cleanReply, createEchoCopilot } from '../lib/copilot.js';
import { sanitizeText } from '../lib/sanitize.js';

const ECHO = createEchoCopilot();

const SendIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-outline-icon="true" data-icon="send">
    <path d="M12 19V5" />
    <path d="M5 12l7-7 7 7" />
  </svg>
);

/**
 * The Copilot chat: a quiet message history (yours on the right, the agent's on the left, rounded bubbles) and one input at the bottom.
 * `reply(text, { t, lang, history })` is the whole connection to the agent (see lib/copilot.js): for now it is the "Analizando..." echo, so the
 * state flow (send -> typing dots -> answer, one question at a time) is already the final one.
 */
export default function AgentChat({ reply = ECHO, className = '' }) {
  const { t, lang } = useI18n();
  const [messages, setMessages] = useState([]); // { id, role: 'user' | 'agent', text }
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const seq = useRef(0);
  const alive = useRef(true);
  const end = useRef(null);
  const text = sanitizeText(draft, COPILOT_LIMITS.inputChars).trim();

  useEffect(() => {
    alive.current = true; // (re-armed on purpose: React's strict mode runs the cleanup once before the real mount)
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' }); // the newest message is always in sight
  }, [messages, thinking]);

  const push = (role, body) => setMessages((list) => [...list, { id: (seq.current += 1), role, text: body }].slice(-COPILOT_LIMITS.historyMessages));

  const send = async (event) => {
    event?.preventDefault();
    if (!text || thinking) return; // empty / blank: nothing to send; one question at a time
    push('user', text);
    setDraft('');
    setThinking(true);
    let answer;
    try {
      answer = cleanReply(await reply(text, { t, lang, history: messages }));
    } catch {
      answer = ''; // a failing agent never breaks the panel: it says so, quietly
    }
    if (!alive.current) return;
    push('agent', answer || t('studio.chat.error'));
    setThinking(false);
  };

  return (
    <section aria-label={t('studio.copilot')} data-testid="agent-chat" className={`flex min-h-0 flex-col ${className}`}>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3" data-testid="agent-scroll">
        <ol role="log" aria-live="polite" aria-label={t('studio.chat.history')} className="flex flex-col gap-3">
          {messages.length === 0 && (
            <li className="px-1 pt-2 text-sm font-light leading-relaxed text-neutral-300" data-testid="agent-empty">
              {t('studio.chat.empty')}
            </li>
          )}
          {messages.map((m) => (
            <li key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <p
                data-testid={`agent-msg-${m.id}`}
                data-role={m.role}
                className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-snug ${
                  m.role === 'user' ? 'rounded-br-md bg-brand/20 font-normal text-neutral-100' : 'rounded-bl-md bg-white/5 font-light text-neutral-100'
                }`}
              >
                {m.text}
              </p>
            </li>
          ))}
          {thinking && (
            <li className="flex justify-start" data-testid="agent-thinking" aria-label={t('studio.chat.thinking')}>
              <span className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-white/5 px-3.5 py-3" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/40" style={{ animationDelay: `${i * 150}ms` }} />
                ))}
              </span>
            </li>
          )}
        </ol>
        <div ref={end} />
      </div>
      <form onSubmit={send} className="flex shrink-0 items-center gap-2 px-3 pb-4 pt-2" data-testid="agent-form">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(sanitizeText(e.target.value, COPILOT_LIMITS.inputChars))}
          maxLength={COPILOT_LIMITS.inputChars}
          placeholder={t('studio.chat.placeholder')}
          aria-label={t('studio.chat.placeholder')}
          autoComplete="off"
          lang={lang}
          data-testid="agent-input"
          className="min-h-[44px] min-w-0 flex-1 rounded-full bg-white/5 px-4 text-sm font-light text-neutral-100 placeholder:text-neutral-400"
        />
        <button
          type="submit"
          disabled={!text || thinking}
          aria-label={t('studio.chat.send')}
          data-testid="agent-send"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-black transition active:scale-95 active:opacity-70 disabled:opacity-30"
        >
          <SendIcon />
        </button>
      </form>
    </section>
  );
}
