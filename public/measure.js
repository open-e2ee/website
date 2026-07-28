/*
 * Cookieless measurement: nine events, no identifiers, nothing stored on or
 * read from the device. Events come from each link's own href, so pages carry
 * no tracking attributes. Declared in /legal/privacy, enforced in
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

  var view = { '/security': 'security_view', '/pricing': 'pricing_view' };
  if (view[path]) send(view[path]);

  addEventListener(
    'click',
    function (event) {
      var link = event.target.closest && event.target.closest('a[href]');
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

  // No copy button exists, so copying is a selection. Never read beyond this.
  addEventListener('copy', function () {
    if (String(getSelection()).includes('@open-e2ee/signal-protocol-sdk')) send('install_copy');
  });
})();
