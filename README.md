# Browser SDK

Files: `sdks/shravelle-sdk-browser/shravelle-browser.js` (no dependencies, also served by Shravelle at `/sdk/shravelle-browser.js`),
`index.d.ts`, `react.js`, `angular.ts`. Feature overview: [features/browser-monitoring.md](https://shravelle.com/docs.html#browser).

## Script tag
```html
<script src="https://shravelle.example.com/sdk/shravelle-browser.js"></script>
<script>Shravelle.init({ endpoint: "https://ingest.example.com", key: "shv_brw_xxx", app: "shop-web", release: "5.3.0" });</script>
```
## npm / bundlers
```js
import Shravelle from "@shravelle/browser";      // sdks/shravelle-sdk-browser
Shravelle.init({ endpoint: ["https://ingest-1.example.com", "https://ingest-2.example.com"], key: "shv_brw_xxx", app: "shop-web" });
```
## React
```jsx
import Shravelle, { ShravelleErrorBoundary } from "@shravelle/browser/react";
Shravelle.init({ ... });
root.render(<ShravelleErrorBoundary fallback={<p>Something went wrong</p>}><App /></ShravelleErrorBoundary>);
```
Next.js: call `init` in a client component that loads once (e.g. in `app/layout`).
## Angular
```ts
import { ShravelleErrorHandler } from "@shravelle/browser/angular";
providers: [{ provide: ErrorHandler, useClass: ShravelleErrorHandler }]
// and call Shravelle.init({...}) in main.ts
```
## Options
| Option | Default | |
|---|---|---|
| `endpoint` | – | URL or array of URLs (failover) |
| `key` | – | browser key |
| `app`, `release` | | |
| `sampleRate` | 1 | share of sessions recorded |
| `flushInterval` | 5000 | ms |
| `maxBatch` | 100 | events per request |
| `tracePropagationTargets` | `[]` | hosts/prefixes/RegExps that get `traceparent` (configure CORS on those APIs to allow the header) |
| `captureClicks`, `captureAjax` | true | |
| `beforeSend(event)` | – | edit or drop (`return null`) events |

## API
`Shravelle.setUser(id)`, `Shravelle.track(name, attributes, value)`, `Shravelle.error(err, attributes)`, `Shravelle.flush()`.

## CSP
Allow `script-src https://shravelle.example.com` (or self-host the file) and `connect-src https://ingest.example.com`.


---
Part of [Shravelle](https://shravelle.com). Setup guide for every platform: [shravelle.com/docs](https://shravelle.com/docs.html) · Get your keys: [shravelle.com/get-started](https://shravelle.com/get-started.html)
