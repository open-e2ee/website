/*
 * First-paint theme resolver, served as an external file because the site's
 * Content-Security-Policy is script-src 'self' with no 'unsafe-inline'. This
 * script is referenced with a blocking <script src> in the document head, so
 * it runs before first paint exactly like the inline form it replaces.
 * Mirrors @open-e2ee/design/theme's contract: `oe-theme` storage key,
 * `.dark` class on <html>, system preference tracked live.
 *
 * It also publishes the preference itself as `data-theme-preference`, which
 * the contract does not cover and nothing outside this site should rely on.
 * The theme switch shows one of three icons, and the resolved theme cannot
 * tell it which: dark-because-chosen and dark-because-system look identical
 * from the `.dark` class alone. Setting it here rather than in the switch's
 * own script is what stops the header painting the wrong icon first.
 *
 * It also writes the resolved canvas into every `theme-color` meta. Those tags
 * answer `prefers-color-scheme`, which is the system's answer and not this
 * site's: a reader who chooses dark under a light system got a cream status bar
 * above a dark header, and on a phone that reads as a gap at the top of the
 * page rather than as a color. Both tags are set to the same value, so
 * whichever one the browser matches is the one the page is painted in.
 *
 * The two hexes are `--oe-canvas` from the design tokens, restated because this
 * file runs before the stylesheet is applied and cannot read a custom property
 * that has not resolved yet. `tests/site-content.test.mjs` holds them to the
 * installed `tokens.css`, so a palette change fails the build here.
 */
(() => {
  try {
    var KEY = 'oe-theme';
    var CANVAS = { light: '#faf7f3', dark: '#0f0e0b' };
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
      document.documentElement.setAttribute('data-theme-preference', preference);
      var canvas = dark ? CANVAS.dark : CANVAS.light;
      var tags = document.head.querySelectorAll('meta[name="theme-color"]');
      for (var i = 0; i < tags.length; i += 1) tags[i].content = canvas;
    };
    apply(stored());
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if (stored() === 'system') apply('system');
    });
  } catch (e) {}
})();
