// Google authentication.
//  - Production: set VITE_GOOGLE_CLIENT_ID and Google Identity Services (GIS) is used.
//  - Without a client id the app runs a clearly-labelled SIMULATION so it works out of the box.
// IMPORTANT for production: the ID token (credential) must also be verified SERVER-SIDE
// (signature, aud, iss, exp) before you trust it for anything beyond showing the user's name.

import { sanitizeText, sanitizeEmail, sanitizeAvatarUrl } from './sanitize.js';

export const GOOGLE_CLIENT_ID = String(import.meta.env?.VITE_GOOGLE_CLIENT_ID || '').trim();
export const googleConfigured = /^[\w-]+\.apps\.googleusercontent\.com$/.test(GOOGLE_CLIENT_ID);

const GSI_SRC = 'https://accounts.google.com/gsi/client';

export function loadGsi(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google);
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    const s = document.createElement('script');
    s.src = GSI_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => {
      clearTimeout(timer);
      window.google?.accounts?.id ? resolve(window.google) : reject(new Error('gsi'));
    };
    s.onerror = () => {
      clearTimeout(timer);
      reject(new Error('offline'));
    };
    document.head.appendChild(s);
  });
}

export function decodeJwtPayload(token) {
  const part = String(token || '').split('.')[1];
  if (!part) throw new Error('bad token');
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Client-side sanity checks only (see note above about server verification). */
export function userFromCredential(credential, { clientId = GOOGLE_CLIENT_ID, now = Date.now() } = {}) {
  const p = decodeJwtPayload(credential);
  const issOk = p.iss === 'https://accounts.google.com' || p.iss === 'accounts.google.com';
  if (!issOk || p.aud !== clientId || typeof p.exp !== 'number' || p.exp * 1000 < now) {
    throw new Error('invalid credential');
  }
  return {
    provider: 'google',
    name: sanitizeText(p.name || p.given_name, 60) || 'Google',
    email: sanitizeEmail(p.email),
    picture: sanitizeAvatarUrl(p.picture),
  };
}

export const demoUser = () => ({ provider: 'demo', name: 'Usuario Demo', email: 'demo@obrax.app', picture: '' });
export const guestUser = () => ({ provider: 'guest', name: 'Invitado', email: '', picture: '' });

/** Local profile: no account, no network. Name is optional and stays on this device. */
export const localUser = (name = '') => ({
  provider: 'local',
  name: sanitizeText(name, 60).trim() || 'Perfil local',
  email: '',
  picture: '',
});
