# Kiorly Lab

Laboratory information management for independent labs and small chains: orders, accession, chain of custody, QC, authorized release.

> **Status: skeleton + build plan (not features).** Ships M15; pilot M19, GA M21. Governing doc: KX-07. Discovery interviews come first (see `Docs/NEEDS_HUMAN.md`); the Prisma schema is a **draft pending discovery**.

Part of Kiorly by Kiorex. Works standalone; talks to Kiorex only over HMAC REST + outbox webhooks (KX-09). Never imports another product's source or DB.

## Layout

| Path | What |
|---|---|
| `apps/api` | NestJS 10 + Prisma 6. Health (`/api/v1/health/live`, `/ready`), feature-flag evaluator stub (Kiorex snapshot, product `kiorly-lab`), placeholder modules per PRD bounded context |
| `apps/api/prisma` | Draft schema + initial migration `0001_draft_init` |
| `apps/web` | React + Vite + Tailwind + i18next (AR/EN, RTL) "coming soon / product overview" shell |
| `packages/*` | `@kiorly/lab-shared`: product constants, flag keys, safety controls (never-flags) |
| `Docs/` | Build sequence + progress tracker, NEEDS_HUMAN, design notes from 2025, ADR reference |
| `infra/` | OpenTofu (written separately; not part of this scaffold) |

## Run locally

Prereqs: Node >= 22, workspace Postgres on :5433 (see workspace CLAUDE.md).

```bash
npm install
cp .env.example apps/api/.env        # DATABASE_URL points to kiorly_lab on :5433
npm run db:setup                     # create DB if missing + prisma migrate deploy
npm run dev                          # API http://localhost:3200/api/v1  ·  web http://localhost:5191
```

| Service | URL |
|---|---|
| API | http://localhost:3200/api/v1/health/live , /ready ; Swagger at /docs |
| Web | http://localhost:5191 (proxies `/api` to 3200) |
| DB | postgresql://postgres:postgres@127.0.0.1:5433/kiorly_lab |

## Checks

```bash
npm run typecheck   # api (prisma generate + tsc) + web
npm test            # api: health e2e, schema smoke, feature flags, safety-control guard; web: locale parity
npm run docs:check  # Docs hub present, tracker populated
```

## Feature flags

Evaluated locally from the Kiorex snapshot (`GET /control/v1/flags/snapshot?product=kiorly-lab`, polled every 30 s when `FLAGS_POLL_ENABLED=true`; missing snapshot => code defaults: ON, launch-locked OFF). Keys: `lab.module`, `lab.analyzer_interfaces`, `lab.home_collection`, `lab.kiorex_bookings`. **Safety controls are never flags** (ADR-025) — see `Docs/ADR_REFERENCE.md`.

## Rules

See `.cursor/rules/lab.mdc` and the workspace `CLAUDE.md`. Conventional Commits. No push to `main` without review; no AWS deploys until the founder says so.
