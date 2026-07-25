/*
 * First-paint theme resolver, served as an external file because the site's
 * Content-Security-Policy is script-src 'self' with no 'unsafe-inline'. This
 * script is referenced with a blocking <script src> in the document head, so
 * it runs before first paint exactly like the inline form it replaces.
 * Mirrors @open-e2ee/design/theme's contract: `oe-theme` storage key,
 * `.dark` class on <html>, system preference tracked live.
 */
(() => {
  try {
    var KEY = 'oe-theme';
    var stored = function () {
      var v = localStorage.getItem(KEY) || 'system';
      return v === 'light' || v === 'dark' ? v : 'system';
    };
    var apply = function (preference) {
      var dark =
        preference === 'dark' ||
        (preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    };
    apply(stored());
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if (stored() === 'system') apply('system');
    });
  } catch (e) {}
})();
