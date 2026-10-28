# Tender Sites Portal (Vue + Fastify)

The Tender Sites Portal is rebuilt here with a Vue 3 front end and a Fastify API. It shows every Confirmed List site on URA's Current GLS Sites page, with nearby MRT stations, schools and amenities, a price estimate with an optional AI assessment, Nearby MRT line diagrams, COT/TCOT tender document upload and generation, and URA transactions with an Excel export of comparables.

The features match the Next.js version in `../tender sites`, whose README describes each one in detail.

## Layout

```
packages/core   Domain logic shared by both apps (TypeScript source, no build step):
                URA scraper, nearby places, walking routes, valuation, AI assessment,
                transactions + Excel export, AgentCore client. Data in data/*.json. Vitest tests.
apps/api        Fastify 5 API. Serves /api/* and, in production, the built Vue app.
apps/web        Vue 3 + Vite + Vue Router + Tailwind CSS 4 + Leaflet (OneMap tiles).
```

There is no database yet. Data is kept like this:

| What | Where it lives now |
| --- | --- |
| URA sites, parcels, geocodes | In memory, 6 h stale-while-revalidate (`packages/core/src/lib/cache.ts`) |
| Walking routes | In memory, 1 week (`walking.ts`) |
| URA transactions (~130k rows) | In memory, 24 h (`transactions.ts`) |
| AI assessments | JSON files under `.data/ai-assessments` (`assessmentStore.ts`) |

When a database is added, replace `fileStore()` in `assessmentStore.ts` first, then move the transactions and caches into it. Each container instance currently keeps its own copy of everything held in memory.

## Run locally

Requires Node 22+. Copy `.env.example` to `.env.local` at the repo root and fill in the keys. Never commit it.

```bash
npm install
npm run dev          # API on :3000, Vue on http://localhost:5173 (proxies /api to :3000)
npm test             # 50 Vitest tests in packages/core
npm run typecheck    # all workspaces (tsc + vue-tsc)
npm run build        # apps/web/dist + apps/api/dist/server.js
npm start            # production server on :3000, serving the built Vue app
```

## API

| Method and path | Returns |
| --- | --- |
| `GET /api/health` | `{ status, time }` |
| `GET /api/sites` | All sites, each with its nearest MRT stations and primary schools (straight line) |
| `GET /api/sites/:slug` | `{ site, nearby }` with walking distances (`?nearby=0` for the site only) |
| `GET /api/sites/:slug/mrt` | The 3 stations nearest on foot |
| `GET /api/sites/:slug/valuation` | Comparables and the residual land value baseline |
| `GET` / `POST /api/sites/:slug/valuation/ai` | Saved AI assessment / get-or-create (`?refresh=1` regenerates, a paid call) |
| `GET /api/sites/:slug/documents` | Uploaded COT/TCOT and generated reports |
| `POST /api/sites/:slug/documents/upload` | Multipart `docType` + `file` (PDF/Word, up to 20 MB) |
| `POST /api/sites/:slug/documents/generate` | Runs `generate_report`. Returns 202 if still running after `GENERATE_WAIT_MS` |
| `GET /api/transactions/meta` | Districts and tender sites for the filter form |
| `GET /api/transactions` | One page of filtered transactions plus stats |
| `GET /api/transactions/projects` | Project names, optionally limited to the given districts |
| `GET /api/transactions/export` | The comparables `.xlsx` file |

## Deploy to AWS

The `Dockerfile` builds one image. Fastify listens on port 3000, serves the API and the Vue app from the same origin, and answers health checks at `/api/health`.

```bash
docker build -t tender-sites .
docker run -p 3000:3000 --env-file .env.local -v tender-data:/app/.data tender-sites
```

**AWS App Runner** is the simplest option. Push the image to ECR, create an App Runner service on port 3000, and set the health check path to `/api/health`. Set the environment variables, and keep secrets in Secrets Manager: `URA_ACCESS_KEY`, `AWS_BEARER_TOKEN_BEDROCK`, `BEDROCK_REGION`, the `COGNITO_*` variables and `AGENTCORE_RUNTIME_URL`. App Runner has no persistent disk, so saved AI assessments are lost on each redeploy until a database is added. It also limits each request to 120 seconds, which is why Generate replies 202 after 100 s and the page polls for the report.

**ECS on Fargate behind an ALB** is the option to choose if assessments must persist before the database exists. Mount EFS at `/app/.data`. Raise the ALB idle timeout above `GENERATE_WAIT_MS`.

Either way, run one instance until the database lands, so that every visitor sees the same saved assessments.

## Changes from the Next.js version

- Next.js's fetch cache (`next: { revalidate }`) is replaced by the in-memory cache in `cache.ts`.
- Server-rendered pages are now Vue pages that call the API. Leaflet is driven directly, with no React wrapper.
- `daysUntil` moved to `dates.ts`, so the browser can use it without pulling in the scraper.
- The upload limit went from 4 MB (a Vercel cap) to 20 MB (`packages/core/src/lib/limits.ts`).
- ESLint is not set up yet. `.gitlab-ci.yml` runs typecheck, tests and build on every MR, builds the Docker image on `main` and refreshes datasets on a schedule.
