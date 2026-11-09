// Test doubles for the DIRECT Gemini call of the app (BYOK, src/lib/gemini.js): there is no proxy to mock any more.
import { clearGeminiKey, setGeminiKey } from '../../src/lib/geminiKey.js';

export const TEST_KEY = 'AIzaSyTEST_key_0123456789_abcdefghijk';
export const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com/';

/** Save the test key on this "device" (call in beforeEach); `seedKey(null)` = no key. */
export const seedKey = (key = TEST_KEY) => (key ? setGeminiKey(key) : clearGeminiKey());

export const isGemini = (url) => String(url).startsWith(GEMINI_ORIGIN);

/** What Gemini answers: `obj` is the JSON the model wrote (a string is used as is). */
export const geminiReply = (obj, { status = 200, extra = {} } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => ({ candidates: [{ content: { parts: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] } }], ...extra }),
});

/** A Google error answer: `{ error: { status, message } }`. */
export const geminiError = (status, message = '', code = '') => ({ ok: false, status, json: async () => ({ error: { status: code, message } }) });

/** A fetch that answers every Gemini call with `reply(url, init)` and lets everything else through to `rest` (default: a 404). */
export const geminiFetch = (reply, rest = async () => ({ ok: false, status: 404, json: async () => ({}) })) =>
  async (url, init) => (isGemini(url) ? reply(url, init) : rest(url, init));
