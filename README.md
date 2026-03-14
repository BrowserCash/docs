# Driver Docs

This folder contains documentation for the Driver platform: Dashboard, Lisa (Cloudflare Worker), Tron (Agents), and the Billing Worker.

- Start at `docs/index.mdx` for an overview
- See `docs/quickstart.mdx` to configure env, deploy Workers, and run Tron
- See `docs/development.mdx` for local dev
- See `docs/api-reference` for key endpoints

## Preview locally

We use Mintlify for the docs site. To preview the docs locally:

```
npm i -g mint
mint dev
```

Open http://localhost:3000.

## Structure

- `index.mdx` — overview + flow
- `quickstart.mdx` — setup and first run
- `development.mdx` — local development for each service
- `api-reference/` — endpoint overview
