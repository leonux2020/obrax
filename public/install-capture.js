/* Runs from <head> as a classic script, before the app bundle: Chromium fires `beforeinstallprompt` once and early.
   It keeps the event for the "Instalar App" buttons (src/pwa/installPrompt.js adopts it) and notes `appinstalled`. */
(function (w) {
  var s = (w.__cubraxInstall = { event: null, installed: false });
  w.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    s.event = e;
  });
  w.addEventListener('appinstalled', function () {
    s.installed = true;
    s.event = null;
  });
})(window);
