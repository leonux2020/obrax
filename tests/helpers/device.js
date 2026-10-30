// Simulate the device the app runs on (time zone + browser languages); `resetDevice()` brings back the default Chilean phone.
const DEFAULT = { timeZone: 'America/Santiago', languages: ['es-CL', 'es'] };

export const setDevice = ({ timeZone = DEFAULT.timeZone, languages = DEFAULT.languages } = {}) => {
  globalThis.__device = { timeZone, languages };
};
export const resetDevice = () => setDevice();
