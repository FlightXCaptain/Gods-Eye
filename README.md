# God's Eye

Live wireframe-globe surveillance dashboard. Streams from public APIs (USGS seismic, NASA EONET, NOAA SWPC/NGDC, airplanes.live ADS-B, tle.ivanstanojevic.me, wheretheiss.at, Wikimedia EventStream, AISStream).

Glass-morphism UI, dark default, rose accent, time-travel slider, locate-target search, live feed.

## Stack

Single static HTML entry + serverless function for the one secret. Loaded at runtime:
- Tailwind CSS (CDN)
- React 18 (UMD)
- Babel Standalone (in-browser JSX)
- D3 v7 + topojson-client + satellite.js

```
.
├── index.html           # boot shell
├── api/config.js        # returns AISSTREAM_KEY from Vercel env
├── src/
│   ├── keys.js          # fetches /api/config on load
│   ├── data.jsx         # public-API fetchers
│   ├── ships.jsx        # AIS websocket
│   ├── globe2.jsx       # D3 orthographic globe, LOD rendering
│   └── app2.jsx         # React app shell
```

## Local development

```bash
vercel dev
```

Needs `AISSTREAM_KEY` in the `development` Vercel env (`vercel env add AISSTREAM_KEY development`). Pull locally with `vercel env pull --environment=development .env.local`.

## Deploy

Pushes to `main` auto-deploy via the Vercel ↔ GitHub integration. Manual: `vercel deploy --prod`.

## Env vars

| name | scope | source |
|---|---|---|
| `AISSTREAM_KEY` | production, preview, development | https://aisstream.io (free) |
