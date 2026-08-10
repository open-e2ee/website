/*
 * The marks in the hero's platform strip.
 *
 * Every path here is either an official brand mark or drawn in this repository.
 * None is an approximation of someone else's logo redrawn from memory, which
 * would misrepresent a brand while claiming to show it.
 *
 * The five official marks come from simple-icons 16.28.0, whose icon files are
 * CC0-1.0 and whose entries carry the vendor's own brand page as `source`. The
 * package was installed with --no-save, the paths were extracted once, and it
 * is not a dependency of this site — the bytes live here so the page ships
 * self-contained with no remote asset and no build-time fetch.
 *
 * CC0 covers copyright in the file, not trademark in the mark. These are shown
 * to state where the SDK runs and what it plugs into, which is nominative use:
 * each is rendered monochrome in the page's own muted colour rather than in
 * brand colour, at uniform size, with no vendor's name claimed as a partner or
 * endorser. `hex` is deliberately not carried across — a strip in brand colours
 * is the visual grammar of a partner wall, and this is a compatibility list.
 *
 * Two entries have no official mark and are drawn here instead:
 *
 *   'browser'  — a browser is not a company. A generic window is the honest
 *                glyph, and there is no mark to misuse.
 *   's3'       — simple-icons carries no Amazon S3 mark, and this adapter is
 *                not an AWS integration: ./remote/object-store/s3 is a
 *                provider-neutral client for presigned URLs that a broker the
 *                application implements mints, with no @aws-sdk dependency
 *                anywhere in the SDK. An AWS mark here would claim an
 *                integration that does not exist. A generic bucket says the
 *                true thing: any S3-compatible store.
 */

export const platformMarks = {
  'expo': {
    label: "Expo",
    /* Expo, official mark: https://expo.dev/brand/ */
    fillRule: 'nonzero',
    path: 'M0 20.084c.043.53.23 1.063.718 1.778.58.849 1.576 1.315 2.303.567.49-.505 5.794-9.776 8.35-13.29a.761.761 0 011.248 0c2.556 3.514 7.86 12.785 8.35 13.29.727.748 1.723.282 2.303-.567.57-.835.728-1.42.728-2.046 0-.426-8.26-15.798-9.092-17.078-.8-1.23-1.044-1.498-2.397-1.542h-1.032c-1.353.044-1.597.311-2.398 1.542C8.267 3.991.33 18.758 0 19.77Z',
  },
  'react-native': {
    /* The key is the SDK's store id and the label is the founder's word for the
       row. They differ here: `./local/store/react-native` is the bare React
       Native store, and the strip says "React".

       Recorded rather than silently reconciled, because the quickstart caveat
       further down the page still reads "The bare React Native store is
       experimental" — it is pinned to the `(experimental)` markers in the
       installed ADAPTERS.md and cannot take the shorter word without saying
       something ADAPTERS.md does not. So the row and that sentence use two
       names for one store, which was raised and is the founder's call. */
    label: "React",
    /* React, official mark: https://github.com/facebook/create-react-app/blob/282c03f9525fdf8061ffa1ec50dce89296d916bd/test/fixtures/relative-paths/src/logo.svg */
    fillRule: 'nonzero',
    path: 'M14.23 12.004a2.236 2.236 0 0 1-2.235 2.236 2.236 2.236 0 0 1-2.236-2.236 2.236 2.236 0 0 1 2.235-2.236 2.236 2.236 0 0 1 2.236 2.236zm2.648-10.69c-1.346 0-3.107.96-4.888 2.622-1.78-1.653-3.542-2.602-4.887-2.602-.41 0-.783.093-1.106.278-1.375.793-1.683 3.264-.973 6.365C1.98 8.917 0 10.42 0 12.004c0 1.59 1.99 3.097 5.043 4.03-.704 3.113-.39 5.588.988 6.38.32.187.69.275 1.102.275 1.345 0 3.107-.96 4.888-2.624 1.78 1.654 3.542 2.603 4.887 2.603.41 0 .783-.09 1.106-.275 1.374-.792 1.683-3.263.973-6.365C22.02 15.096 24 13.59 24 12.004c0-1.59-1.99-3.097-5.043-4.032.704-3.11.39-5.587-.988-6.38-.318-.184-.688-.277-1.092-.278zm-.005 1.09v.006c.225 0 .406.044.558.127.666.382.955 1.835.73 3.704-.054.46-.142.945-.25 1.44-.96-.236-2.006-.417-3.107-.534-.66-.905-1.345-1.727-2.035-2.447 1.592-1.48 3.087-2.292 4.105-2.295zm-9.77.02c1.012 0 2.514.808 4.11 2.28-.686.72-1.37 1.537-2.02 2.442-1.107.117-2.154.298-3.113.538-.112-.49-.195-.964-.254-1.42-.23-1.868.054-3.32.714-3.707.19-.09.4-.127.563-.132zm4.882 3.05c.455.468.91.992 1.36 1.564-.44-.02-.89-.034-1.345-.034-.46 0-.915.01-1.36.034.44-.572.895-1.096 1.345-1.565zM12 8.1c.74 0 1.477.034 2.202.093.406.582.802 1.203 1.183 1.86.372.64.71 1.29 1.018 1.946-.308.655-.646 1.31-1.013 1.95-.38.66-.773 1.288-1.18 1.87-.728.063-1.466.098-2.21.098-.74 0-1.477-.035-2.202-.093-.406-.582-.802-1.204-1.183-1.86-.372-.64-.71-1.29-1.018-1.946.303-.657.646-1.313 1.013-1.954.38-.66.773-1.286 1.18-1.868.728-.064 1.466-.098 2.21-.098zm-3.635.254c-.24.377-.48.763-.704 1.16-.225.39-.435.782-.635 1.174-.265-.656-.49-1.31-.676-1.947.64-.15 1.315-.283 2.015-.386zm7.26 0c.695.103 1.365.23 2.006.387-.18.632-.405 1.282-.66 1.933-.2-.39-.41-.783-.64-1.174-.225-.392-.465-.774-.705-1.146zm3.063.675c.484.15.944.317 1.375.498 1.732.74 2.852 1.708 2.852 2.476-.005.768-1.125 1.74-2.857 2.475-.42.18-.88.342-1.355.493-.28-.958-.646-1.956-1.1-2.98.45-1.017.81-2.01 1.085-2.964zm-13.395.004c.278.96.645 1.957 1.1 2.98-.45 1.017-.812 2.01-1.086 2.964-.484-.15-.944-.318-1.37-.5-1.732-.737-2.852-1.706-2.852-2.474 0-.768 1.12-1.742 2.852-2.476.42-.18.88-.342 1.356-.494zm11.678 4.28c.265.657.49 1.312.676 1.948-.64.157-1.316.29-2.016.39.24-.375.48-.762.705-1.158.225-.39.435-.788.636-1.18zm-9.945.02c.2.392.41.783.64 1.175.23.39.465.772.705 1.143-.695-.102-1.365-.23-2.006-.386.18-.63.406-1.282.66-1.933zM17.92 16.32c.112.493.2.968.254 1.423.23 1.868-.054 3.32-.714 3.708-.147.09-.338.128-.563.128-1.012 0-2.514-.807-4.11-2.28.686-.72 1.37-1.536 2.02-2.44 1.107-.118 2.154-.3 3.113-.54zm-11.83.01c.96.234 2.006.415 3.107.532.66.905 1.345 1.727 2.035 2.446-1.595 1.483-3.092 2.295-4.11 2.295-.22-.005-.406-.05-.553-.132-.666-.38-.955-1.834-.73-3.703.054-.46.142-.944.25-1.438zm4.56.64c.44.02.89.034 1.345.034.46 0 .915-.01 1.36-.034-.44.572-.895 1.095-1.345 1.565-.455-.47-.91-.993-1.36-1.565z',
  },
  'node': {
    label: "Node.js",
    /* Node.js, official mark: https://nodejs.org/en/about/branding */
    fillRule: 'nonzero',
    path: 'M11.998,24c-0.321,0-0.641-0.084-0.922-0.247l-2.936-1.737c-0.438-0.245-0.224-0.332-0.08-0.383 c0.585-0.203,0.703-0.25,1.328-0.604c0.065-0.037,0.151-0.023,0.218,0.017l2.256,1.339c0.082,0.045,0.197,0.045,0.272,0l8.795-5.076 c0.082-0.047,0.134-0.141,0.134-0.238V6.921c0-0.099-0.053-0.192-0.137-0.242l-8.791-5.072c-0.081-0.047-0.189-0.047-0.271,0 L3.075,6.68C2.99,6.729,2.936,6.825,2.936,6.921v10.15c0,0.097,0.054,0.189,0.139,0.235l2.409,1.392 c1.307,0.654,2.108-0.116,2.108-0.89V7.787c0-0.142,0.114-0.253,0.256-0.253h1.115c0.139,0,0.255,0.112,0.255,0.253v10.021 c0,1.745-0.95,2.745-2.604,2.745c-0.508,0-0.909,0-2.026-0.551L2.28,18.675c-0.57-0.329-0.922-0.945-0.922-1.604V6.921 c0-0.659,0.353-1.275,0.922-1.603l8.795-5.082c0.557-0.315,1.296-0.315,1.848,0l8.794,5.082c0.57,0.329,0.924,0.944,0.924,1.603 v10.15c0,0.659-0.354,1.273-0.924,1.604l-8.794,5.078C12.643,23.916,12.324,24,11.998,24z M19.099,13.993 c0-1.9-1.284-2.406-3.987-2.763c-2.731-0.361-3.009-0.548-3.009-1.187c0-0.528,0.235-1.233,2.258-1.233 c1.807,0,2.473,0.389,2.747,1.607c0.024,0.115,0.129,0.199,0.247,0.199h1.141c0.071,0,0.138-0.031,0.186-0.081 c0.048-0.054,0.074-0.123,0.067-0.196c-0.177-2.098-1.571-3.076-4.388-3.076c-2.508,0-4.004,1.058-4.004,2.833 c0,1.925,1.488,2.457,3.895,2.695c2.88,0.282,3.103,0.703,3.103,1.269c0,0.983-0.789,1.402-2.642,1.402 c-2.327,0-2.839-0.584-3.011-1.742c-0.02-0.124-0.126-0.215-0.253-0.215h-1.137c-0.141,0-0.254,0.112-0.254,0.253 c0,1.482,0.806,3.248,4.655,3.248C17.501,17.007,19.099,15.91,19.099,13.993z',
  },
  'convex': {
    label: "Convex",
    /* Convex, official mark: https://www.convex.dev/brand */
    fillRule: 'nonzero',
    path: 'M15.09 18.916c3.488-.387 6.776-2.246 8.586-5.348-.857 7.673-9.247 12.522-16.095 9.545a3.47 3.47 0 0 1-1.547-1.314c-1.539-2.417-2.044-5.492-1.318-8.282 2.077 3.584 6.3 5.78 10.374 5.399m-10.501-7.65c-1.414 3.266-1.475 7.092.258 10.24-6.1-4.59-6.033-14.41-.074-18.953a3.44 3.44 0 0 1 1.893-.707c2.825-.15 5.695.942 7.708 2.977-4.09.04-8.073 2.66-9.785 6.442m11.757-5.437C14.283 2.951 11.053.992 7.515.933c6.84-3.105 15.253 1.929 16.17 9.37a3.6 3.6 0 0 1-.334 2.02c-1.278 2.594-3.647 4.607-6.416 5.352 2.029-3.763 1.778-8.36-.589-11.847',
  },
  'cloudflare-r2': {
    /* The mark carries the company and the word carries the product, so the
       entry still reads "Cloudflare R2" without spending two words on it.

       "R2" alone rather than "Cloudflare" alone, and that is the point of the
       split: the adapter is `./remote/object-store/convex-r2`, so what is
       supported is the object store and not Workers, the CDN, or the rest of
       the platform — which this site itself deploys on. The company name goes
       on the row the day more than one of its products is behind it. */
    label: "R2",
    /* Cloudflare, official mark: https://www.cloudflare.com/logo/ */
    fillRule: 'nonzero',
    path: 'M16.5088 16.8447c.1475-.5068.0908-.9707-.1553-1.3154-.2246-.3164-.6045-.499-1.0615-.5205l-8.6592-.1123a.1559.1559 0 0 1-.1333-.0713c-.0283-.042-.0351-.0986-.021-.1553.0278-.084.1123-.1484.2036-.1562l8.7359-.1123c1.0351-.0489 2.1601-.8868 2.5537-1.9136l.499-1.3013c.0215-.0561.0293-.1128.0147-.168-.5625-2.5463-2.835-4.4453-5.5499-4.4453-2.5039 0-4.6284 1.6177-5.3876 3.8614-.4927-.3658-1.1187-.5625-1.794-.499-1.2026.119-2.1665 1.083-2.2861 2.2856-.0283.31-.0069.6128.0635.894C1.5683 13.171 0 14.7754 0 16.752c0 .1748.0142.3515.0352.5273.0141.083.0844.1475.1689.1475h15.9814c.0909 0 .1758-.0645.2032-.1553l.12-.4268zm2.7568-5.5634c-.0771 0-.1611 0-.2383.0112-.0566 0-.1054.0415-.127.0976l-.3378 1.1744c-.1475.5068-.0918.9707.1543 1.3164.2256.3164.6055.498 1.0625.5195l1.8437.1133c.0557 0 .1055.0263.1329.0703.0283.043.0351.1074.0214.1562-.0283.084-.1132.1485-.204.1553l-1.921.1123c-1.041.0488-2.1582.8867-2.5527 1.914l-.1406.3585c-.0283.0713.0215.1416.0986.1416h6.5977c.0771 0 .1474-.0489.169-.126.1122-.4082.1757-.837.1757-1.2803 0-2.6025-2.125-4.727-4.7344-4.727',
  },

  /* Drawn here: a window frame whose title bar carries a dot and an address
     field, punched out with evenodd so it reads as an outline at the same
     visual weight as the filled marks beside it.

     The address field is what makes it a browser rather than a window, and that
     distinction is the claim: the entry stands for the `web` local store, which
     is IndexedDB in any browser. No licensed mark can say that — the sets carry
     particular browsers, and a Chrome or Firefox glyph would name one engine
     where the store supports all of them. One dot rather than three, because
     the terminal above lost its stoplights in an earlier round and a full set
     here would put them back on the page. */
  browser: {
    label: 'Browser',
    /* evenodd is declared per-mark rather than set on every path, because the
       official marks are drawn for the default nonzero rule and several of them
       carry counter-wound subpaths that become solid blobs under evenodd.

       Here it is load-bearing the other way: the viewport, the address field,
       and the dot are plain subpaths laid over the frame, and they read as
       holes only because an even crossing count leaves them unfilled. Under
       nonzero this mark is one solid rectangle. */
    fillRule: 'evenodd',
    path: 'M3.5 3h17A2.5 2.5 0 0 1 23 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-17A2.5 2.5 0 0 1 1 18.5v-13A2.5 2.5 0 0 1 3.5 3ZM3 9v9.5a.5.5 0 0 0 .5.5h17a.5.5 0 0 0 .5-.5V9H3Zm5.25-3.75h11.5a.75.75 0 0 1 0 1.5H8.25a.75.75 0 0 1 0-1.5Zm-3.9 0a.85.85 0 1 1 0 1.7.85.85 0 0 1 0-1.7Z',
  },

  /* Drawn here: a bucket with a handle — the shape every object store uses for
     itself and no single vendor owns, and "bucket" is S3's own word for the
     thing. The handle is what carries that: without it the body alone reads as
     a cup or a plain trapezoid, which says nothing about storage. Two subpaths,
     a crescent and the pail, both wound the same way so nonzero unions them.

     "S3" names the API the adapter speaks, not Amazon. There is no AWS client
     in any of the SDK's dependency classes — `./remote/object-store/s3` talks
     presigned URLs to any store that implements the protocol — so the bare word
     is only honest under a heading that frames the row as compatibility, which
     is what "Works with" does. `tests/site-content.test.mjs` pins both halves:
     the heading, and the absence of the dependency that would make this an
     integration. */
  s3: {
    label: 'S3',
    fillRule: 'nonzero',
    path: 'M12 1.4a6.6 6.6 0 0 1 6.5 5.5h-2.06A4.6 4.6 0 0 0 12 3.4a4.6 4.6 0 0 0-4.44 3.5H5.5A6.6 6.6 0 0 1 12 1.4ZM2.4 6.9h19.2a1 1 0 0 1 .99 1.14l-1.98 12.5A3 3 0 0 1 17.65 23H6.35a3 3 0 0 1-2.96-2.46L1.41 8.04A1 1 0 0 1 2.4 6.9Z',
  },
};
