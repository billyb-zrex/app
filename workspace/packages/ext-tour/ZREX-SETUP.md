# Z Rex Demo Capture

Build from workspace with Yarn 1.22.22:

```
yarn install --frozen-lockfile
yarn workspace @fable/common build
cd packages/ext-tour
yarn webpack --config webpack.zrex.config.js
```

Load the resulting build-zrex folder using Chrome > chrome://extensions > Developer mode > Load unpacked. Keep the folder in place.

Stable extension ID: `kbpcgfkdinfgocglhopdmmdbhepihgbg`. Set frontend `REACT_APP_EXTENSION_ID` to this value and rebuild the static site. Only `https://demo.zrexsolutions.com/*` can query this extension. The public manifest key is an identity seed, not a secret; no signing private key is stored.

This build uses Z Rex endpoints, disables upstream telemetry, removes cookie permission and collection, and uses system fonts. Capture still needs HTTP/HTTPS page access and follows tabs activated during a recording. Use sample data for validation. Jobs-dependent features stay disabled. The upstream Web Store listing does not install this build.

Open a product page, select Record a new demo in the extension, interact with the page, then Stop Recording. The result opens at demo.zrexsolutions.com/preptour. Installation and end-to-end capture must be verified in Chrome.
