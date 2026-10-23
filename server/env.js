// The single place that reads the Gemini configuration from an environment object. The key is never copied
// anywhere else: callers pass `process.env` / Vite's loaded env in and get a handler config out.
// It is never given a VITE_ prefix, so Vite cannot bundle it into the browser build.

export function readGeminiConfig(env = {}) {
  const apiKey = typeof env.GEMINI_API_KEY === 'string' ? env.GEMINI_API_KEY.trim() : '';
  const model = typeof env.GEMINI_MODEL === 'string' ? env.GEMINI_MODEL.trim() : '';
  return { apiKey, ...(model ? { model } : {}) };
}
