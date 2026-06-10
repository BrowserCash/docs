# Driver Docs

Documentation for Driver's managed browser API.

## Structure

- `docs/index.mdx` — API overview and core session flow
- `docs/introduction/` — introductory getting-started pages
- `docs/fundamentals/` — browser session lifecycle, usage, viewer, and management
- `docs/features/` — profiles, geolocation, node targeting, proxies, and window size
- `docs/integrations/` — Playwright, Puppeteer, Browser-Use, Crawl4AI, and Stagehand
- `docs.json` — Mintlify navigation and site configuration
- `api-reference/openapi.json` — Mintlify OpenAPI reference generated from the live Driver API spec with docs-specific simplifications

The API Reference tab is generated from `api-reference/openapi.json`. The local OpenAPI file is based on `https://api.driver.dev/doc` with docs-specific corrections.

## Preview Locally

```bash
npm i -g mint
mint dev
```

Open `http://localhost:3000`.
