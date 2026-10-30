// Deterministic device for the tests: a phone in Chile, in Spanish, whoever runs them and wherever (the app now follows the device's
// time zone and language, so the machine of the developer or the CI must not leak in). A test simulates travelling with
// `setDevice({ timeZone: 'Europe/Rome', languages: ['it-IT'] })` (tests/helpers/device.js) or by passing the values explicitly.
globalThis.__device = { timeZone: 'America/Santiago', languages: ['es-CL', 'es'] };

if (typeof Intl !== 'undefined' && !Intl.DateTimeFormat.prototype.resolvedOptions.__device) {
  const real = Intl.DateTimeFormat.prototype.resolvedOptions;
  // only the reported zone changes (formatting keeps using the real one: dates in the tests do not move)
  const patched = function resolvedOptions(...args) {
    return { ...real.apply(this, args), timeZone: globalThis.__device.timeZone };
  };
  patched.__device = true;
  Intl.DateTimeFormat.prototype.resolvedOptions = patched;
}

if (typeof navigator !== 'undefined') {
  // on the prototype: a test that overrides `navigator.languages` on the instance and then `delete`s it falls back to this device
  const proto = Object.getPrototypeOf(navigator);
  Object.defineProperty(proto, 'languages', { configurable: true, get: () => globalThis.__device.languages });
  Object.defineProperty(proto, 'language', { configurable: true, get: () => globalThis.__device.languages[0] });
}
