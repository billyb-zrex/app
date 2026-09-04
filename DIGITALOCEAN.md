# DigitalOcean App Platform deployment

Deploy this repository as a **Static Site** component.

## Component settings

- Branch: `codex/digitalocean-core` (change to `develop` after merging)
- Source directory: `/workspace`
- Build command: `yarn workspace @fable/client build-prod`
- Output directory: `/workspace/packages/client/build`
- Catch-all document: `index.html`
- Custom domain: `demo.zrexsolutions.com`

## Build-time environment variables

The production build now reads Create React App variables from the App Platform
build environment. These values are public and are compiled into the browser
bundle.

```text
GENERATE_SOURCEMAP=false
DISABLE_ESLINT_PLUGIN=true
REACT_APP_ENVIRONMENT=prod
REACT_APP_API_ENDPOINT=https://api.demo.zrexsolutions.com
REACT_APP_LOG_ENDPOINT=https://api.demo.zrexsolutions.com
REACT_APP_JOB_ENDPOINT=https://api.demo.zrexsolutions.com
REACT_APP_CLIENT_ENDPOINT=https://demo.zrexsolutions.com
REACT_APP_AUTH0_DOMAIN=zrexsolutions-demo.us.auth0.com
REACT_APP_AUTH0_CLIENT_ID=c1Lr8sy6HTwFkdko0EpSkuW4l0MPpVyy
REACT_APP_AUTH0_AUD=https://api.demo.zrexsolutions.com
REACT_APP_DATA_CDN=<space-name>.<region>.digitaloceanspaces.com
REACT_APP_DATA_CDN_QUALIFIER=root
REACT_APP_CHARGEBEE_SITE=
REACT_APP_AMPLITUDE_KEY=
REACT_APP_POSTHOG_KEY=
REACT_APP_EXTENSION_ID=
```

`REACT_APP_JOB_ENDPOINT` intentionally points to the API during the core launch.
Features that require the jobs service remain unavailable until that service and
its AWS dependencies are deployed.

The Chrome capture extension must be built and distributed separately before
recording from the browser will work. Set `REACT_APP_EXTENSION_ID` to that
extension's ID when it is available.
