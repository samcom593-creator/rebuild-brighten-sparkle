# APEX OS

APEX Financial's operating system and public website. The production site is
[apex-financial.org](https://apex-financial.org).

## Stack

- React 18, TypeScript, and Vite
- Tailwind CSS and shadcn/ui
- React Router and TanStack Query
- Supabase for authentication, data, realtime, and Edge Functions
- Vercel for the web application and server routes

## Local development

```sh
npm install
cp .env.example .env.local
npm run dev
```

Fill `.env.local` with the approved development or staging values. Only
`VITE_*` variables are exposed to the browser; keep service-role and provider
secrets in the appropriate secret manager.

## Verification

Run the same core gate used by CI before merging:

```sh
npm run verify:core
npm test
```

Useful targeted production checks:

```sh
npm run smoke:prod
npm run audit:links
npm run lighthouse:prod
```

The link audit requires Playwright. It first uses the repository dependency and
then the operations-bot fallback at
`/tmp/apex-link-audit-playwright/node_modules/playwright`.

## Deployment

Vercel builds `main` with `vite build` and publishes `dist`; routing, security
headers, health endpoints, and service-worker cache rules live in
[`vercel.json`](./vercel.json). The Supabase project is deployed separately, so
database migrations and Edge Function changes must be applied and verified in
their own release step.

Do not publish this repository through Lovable. The remaining
`@lovable.dev/cloud-auth-js` dependency is an Edge Function AI-gateway
dependency, not the website host.
