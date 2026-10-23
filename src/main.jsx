import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { installShield } from './lib/shield.js';
import { consumeOAuthCallback } from './lib/oauthCallback.js';
import { startInstallCapture } from './pwa/installPrompt.js';
import './index.css';

installShield();
startInstallCapture(); // `beforeinstallprompt` fires once and early: keep it for the Instalar App buttons
// Google may send the user back with its answer in the address (Drive consent by redirect). Catch it BEFORE the app
// renders, clean the address and keep only the outcome: this is what used to leave a blank screen.
consumeOAuthCallback();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
