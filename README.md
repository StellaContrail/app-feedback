# app-feedback

A browser-extension-based feedback tool for small web app review sessions.

## MVP

- Select a DOM element on a web page and leave feedback.
- Store feedback in Cloudflare Workers + D1; screenshots in R2.
- Show feedback pins to other participants on the same page.
- Manage review sessions and participating apps from a small dashboard.

## Architecture

- Chrome Manifest V3 extension (TypeScript, React)
- Cloudflare Workers API (Hono, Zod)
- Cloudflare D1 (feedback and sessions), R2 (screenshots)
- Monorepo with pnpm; CI with GitHub Actions

Implementation is pending. See `AGENTS.md` and `docs/` for specifications once the starter PR is merged.

Never commit credentials. Production deployment and public distribution require explicit approval.
