// The report PDF asks the server for /icon-192.png (its fallback logo). There is no server in the test runner, so the
// request is answered with a 404 right here instead of an ECONNREFUSED stack on the console; the PDF then simply has
// no logo, exactly as in production when the icon cannot be fetched. Every other request is left untouched.
const realFetch = globalThis.fetch;
if (typeof realFetch === 'function' && !realFetch.__noIconFetch) {
  const wrapped = (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    if (/(^|\/)icon-192\.png(\?|$)/.test(url)) return Promise.resolve(new Response(null, { status: 404 }));
    return realFetch.call(globalThis, input, init);
  };
  wrapped.__noIconFetch = true;
  globalThis.fetch = wrapped;
}
