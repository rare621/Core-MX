# CoreMX online sync over HTTPS

The official service origin is `https://coremx.app`. Every API path remains under `/v1/`, for example `https://coremx.app/v1/health`.

The existing Cloudflare-proxied website forwards only `/v1/` requests to `http://127.0.0.1:60000` on the same PC. The app does not connect to the public-IP service URL. `previousServiceUrls` entries are identity-migration aliases, never network fallbacks; existing IDs and bearer tokens remain associated with the same account database.

## Website integration

Copy `server/coremx-website-proxy.js` beside the website's `server.js` as `sync-proxy.js`. Import `{ proxySync }` from `./sync-proxy` and call it before the website's API/static fallback:

```js
if (url.pathname.startsWith('/v1/')) return proxySync(req, res);
```

The proxy streams JSON and binary uploads/downloads, forwards Authorization and status codes, removes website cookies and hop-by-hop headers, and disables caching. It uses a fixed localhost destination and cannot proxy arbitrary URLs. Existing sync-server authentication and file limits still apply. Anonymous rate limits share the proxy's local address; authenticated limits remain per account.

## Verification before a client rollout

1. Confirm `http://127.0.0.1:60000/v1/health` and `https://coremx.app/v1/health` return the same JSON service version, not the website HTML.
2. Confirm the public response passes through Cloudflare and TLS certificate validation succeeds.
3. Compare read-only `/v1/friends` responses using an existing token on both routes. A 401 on both indicates a pre-existing invalid sign-in; do not reset server accounts during migration.
4. Run `node --test test/online.test.js test/sync-proxy.test.js`.
5. Bundle `online.config.json` using the existing release hooks and restart the app after updating its installed resource config.

Do not close shared ports 80/443: other sites may use them. Retire the direct sync port forward only after all clients migrate. Other domains, game servers, DNS history, and migration aliases can still reveal the origin IP; this change protects the sync connection rather than promising IP anonymity.

Cloudflare plan request-size and timeout limits also apply. In particular, the default 100 MB proxied upload limit may be smaller than the sync server's 128 MiB file limit. Files above the edge limit require a compatible plan or a separate chunked-transfer implementation; do not fall back to the public IP.
