/*
 * Cookieless measurement: eleven events, no identifiers, nothing stored on or
 * read from the device. Most events come from each link's own href, so pages
 * carry no tracking attributes. Declared in /legal/privacy, enforced in
 * src/workers/site.ts.
 */
(() => {
  var path = location.pathname.replace(/\/$/, '') || '/';

  var send = function (name, label) {
    var body = name + ' ' + path + (label ? ' ' + label : '');
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('/e', body)) return;
      fetch('/e', { method: 'POST', body: body, keepalive: true });
    } catch (e) {}
  };

  /*
   * The one thing this file publishes, for an event no link can express: the
   * homepage demo's run is a button inside that demo's own module, and giving
   * the handler below its selectors would spread the demo across two files.
   * A caller passes a name and at most a label, never a body — the path and
   * the wire format stay here, and the collector drops a name or a label it
   * does not already know.
   */
  window.oeMeasure = send;

  var view = { '/security': 'security_view', '/pricing': 'pricing_view' };
  if (view[path]) send(view[path]);

  addEventListener(
    'click',
    function (event) {
      if (!event.target.closest) return;
      if (event.target.closest('[data-install-copy]')) return send('install_copy');
      var link = event.target.closest('a[href]');
      if (!link) return;
      var href = link.href;
      var runtime = /\/start\/(expo|browser|node)\b/.exec(href);
      if (href.includes('/start/quickstart')) {
        // Reaching this link from writing means finishing it, not starting.
        send(path.startsWith('/blog/') || path === '/learn' ? 'guide_finish' : 'quickstart_open');
      } else if (runtime) send('runtime_select', runtime[1]);
      else if (href.includes('github.com/open-e2ee')) send('github_open');
      else if (href.includes('console.open-e2ee.dev')) {
        send(href.includes('plan=enterprise') ? 'enterprise_contact' : 'signup_start');
      }
    },
    true,
  );

  // Pages without the copy button still let a reader select the command by
  // hand. `navigator.clipboard.writeText` raises no `copy` event, so the two
  // paths cannot both fire for one action. Never read beyond this.
  addEventListener('copy', function () {
    if (String(getSelection()).includes('@open-e2ee/signal-protocol-sdk')) send('install_copy');
  });
})();
