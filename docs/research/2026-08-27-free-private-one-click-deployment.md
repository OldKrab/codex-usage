# Free, private, one-click deployment research

Date: 2026-08-27

## Goal

Let a user click a deployment button in the repository, obtain a personal hosted Codex Usage Dashboard, pay nothing for normal personal use, and keep the production URL accessible only to that user without creating a separate dashboard password.

## Current application constraints

The current application is not a stateless frontend:

- one long-running Node HTTP server serves both API and static assets;
- OAuth credentials, history, settings, alert state, and optional-provider state are stored in seven local JSON files under `data/`;
- background refresh uses an in-process `setInterval`;
- refresh tokens must survive restarts and deploys;
- the browser can trigger refresh, account creation, login, logout, deletion, and settings mutations;
- the OpenAI Codex OAuth client redirects to localhost, so remote deployments rely on the existing manual callback-URL paste flow.

A suitable free platform therefore needs durable storage, scheduled work, HTTPS, secrets, and owner-only visitor access. A random platform subdomain alone is not access control.

### Hosted feature scope

The one-click edition should be explicitly **Codex-only** at launch:

- Claude Code reads and refreshes a credentials file from the user's local `~/.claude` directory;
- OpenCode Go reads a local SQLite database/cache unless the user manually supplies an API key;
- Cursor reads a local auth file unless the user manually supplies an access token;
- Telegram alerts require the user to create a bot and provide secrets.

Those files do not exist inside an independently deployed Netlify or Cloudflare runtime. Exposing credential-paste forms for every optional provider would make onboarding less safe and less one-click. The hosted target should hide those integrations server-side and in the frontend, then add explicit remote connection flows later if warranted. The self-hosted Node target can keep them.

## Best current fit: Netlify

Netlify is the closest match to the requested user experience after its 2026 project-visibility changes.

### Deployment UX

Netlify provides an official **Deploy to Netlify** button. It clones the public template repository into the user's Git provider account and configures/deploys the project from `netlify.toml`.

Source: https://docs.netlify.com/deploy/create-deploys/

### Owner-only access on the free plan

Credit-based Free plans support private projects. A private project is enforced with Netlify login. On Free and Personal plans only the Team Owner can view it.

New Netlify teams created on or after 2026-07-28 default to **Private for new projects**, so a new user following the deploy button should receive a private production deployment without creating an application-specific password. Older teams can still have a public default and must change Project configuration → General → Visitor access → Project visibility to Private.

Sources:

- https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/
- https://docs.netlify.com/manage/security/secure-access-to-sites/password-protection/

### Persistent state

Netlify Blobs is available on the Free plan and can be used from Functions without manually provisioning a database. Site-wide stores persist across deploys.

Blobs defaults to eventual consistency and last-write-wins. The migration must not preserve the current whole-file read/modify/write pattern blindly. State should be split into separate keys, with immutable history samples and conditional writes (`onlyIfMatch` / `onlyIfNew`) for mutable account and alert records.

Source: https://docs.netlify.com/build/data-and-storage/netlify-blobs/

### Background refresh

Scheduled Functions are available on all plans, use normal cron expressions, and have a 30-second execution limit. They can replace the in-process timer.

Source: https://docs.netlify.com/build/functions/scheduled-functions/

### Free-tier budget

The credit-based Free plan supplies 300 credits/month with a hard stop and no automatic charge. Relevant rates include:

- production deploy: 15 credits;
- Functions compute: 10 credits per GB-hour;
- default Function memory: 1 GB;
- web traffic: 2 credits per 10,000 requests.

At a five-minute refresh cadence there are 8,640 scheduled runs in a 30-day month. At 1 GB default memory this costs approximately:

| Average refresh duration | Monthly compute | Credits |
|---:|---:|---:|
| 1 second | 2.4 GB-hours | 24 |
| 2 seconds | 4.8 GB-hours | 48 |
| 5 seconds | 12 GB-hours | 120 |
| 10 seconds | 24 GB-hours | 240 |

One initial production deployment leaves 285 credits. Five-minute refresh is therefore plausible if provider refresh normally finishes well below ten seconds, but it is not guaranteed without a prototype measurement. For the hosted target, a **15-minute background schedule plus fast refresh while the page is open** is a better default: at a pessimistic five-second scheduled invocation it uses about 40 compute credits/month instead of 120. Codex usage is cumulative, so this still preserves useful history while leaving substantial budget for browser-triggered API calls and future production deployments.

Sources:

- https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/
- https://docs.netlify.com/build/functions/usage-and-billing/
- https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/

### Required migration

The React UI can remain mostly unchanged. The backend requires a real serverless adaptation:

1. Replace the Node `http.createServer` router with Netlify Functions.
2. Move local JSON storage to Netlify Blobs using per-record keys and conditional writes.
3. Replace `setInterval` with a Scheduled Function.
4. Route `/api/*` and `/auth/callback` through `netlify.toml` redirects.
5. Keep provider tokens out of API responses; rely on Netlify's encrypted-at-rest storage and environment-secret handling.
6. Add a health endpoint and a deploy-time smoke test.
7. Measure a real refresh invocation; start with a 15-minute background cron and retain fast refresh while the page is open.
8. Document that old Netlify teams must verify project visibility is Private.

## Cloudflare Workers alternative

Cloudflare has the strongest raw storage/request free quotas, but a less friendly onboarding path:

- official Deploy to Cloudflare button;
- automatic provisioning and binding of declared Cloudflare resources such as D1, KV, R2, and Durable Objects;
- 100,000 Worker requests/day;
- static asset requests are free and unlimited;
- D1 Free includes 5 million rows read/day, 100,000 rows written/day, and 5 GB total storage;
- up to 5 Cron Triggers per account.

Workers Free also imposes a **10 ms CPU limit per HTTP or Cron invocation**. Network waiting does not count as CPU, but normalization, history processing, encryption, and forecasting must remain very small or be split across requests. This needs a real prototype rather than assuming the current Node refresh routine will fit unchanged.

Sources:

- https://developers.cloudflare.com/workers/platform/deploy-buttons/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/workers/configuration/cron-triggers/

The privacy flow is less automatic. Cloudflare Access can protect a production `workers.dev` Worker, including a policy allowing only members of the user's Cloudflare account. The user must still:

1. configure an account-level `workers.dev` subdomain if this is their first Worker;
2. complete Zero Trust onboarding, which asks for payment details even on the advertised $0 Free plan;
3. enable **Protect this Worker behind Access** and choose the traffic scope/policy;
4. configure One-time PIN and an email allow-list if they do not use the Cloudflare-account policy.

Access is not among the resources the public Deploy Button promises to provision automatically. This is materially more setup than Netlify, where teams created on or after 2026-07-28 start with new projects private and owner-only by default.

Source: https://developers.cloudflare.com/workers/configuration/cloudflare-access/

Cloudflare remains the better choice if Netlify's 300-credit budget proves too tight in a prototype. It requires a larger runtime rewrite from Node APIs to Worker APIs and D1.

## Other platforms

| Platform | Free and persistent? | One-click | Owner-only production | Verdict |
|---|---|---|---|---|
| Vercel Hobby | Functions have read-only filesystem except temporary `/tmp`; production cron is limited to once/day | Yes | Production domain remains public under standard Hobby protection | Reject for this app |
| Railway | Free plan gives $1 monthly credit after trial; volumes exist | Excellent templates | Public domains are public; app auth required | Easy but not reliably free |
| Render Free | Sleeps after 15 minutes; free services cannot attach persistent disks | Deploy button | No owner-only public web URL | Reject |
| Fly.io | Trial is 2 machine-hours or 7 days, then billing is required | Not equivalent to README one-click | App auth required | Reject |
| Koyeb Free | Free instance sleeps and cannot use volumes; free PostgreSQL has only 5 active hours | Deploy button | App auth required | Reject |
| Deno Deploy | Free KV, cron, and deploy button are promising | Yes | No verified owner-only production protection | Technically viable, weaker UX/privacy fit |
| Supabase | Free database/auth/functions/cron components | Multi-service setup | Auth can solve privacy | Too many setup steps for the requested UX |

Primary sources:

- Vercel filesystem: https://vercel.com/docs/functions/runtimes
- Vercel cron: https://vercel.com/docs/cron-jobs/usage-and-pricing
- Vercel protection: https://vercel.com/docs/deployment-protection
- Railway free trial: https://docs.railway.com/pricing/free-trial
- Railway volumes: https://docs.railway.com/volumes/reference
- Render Free: https://render.com/docs/free
- Fly trial: https://fly.io/docs/about/free-trial/
- Koyeb instances: https://www.koyeb.com/docs/reference/instances
- Koyeb pricing FAQ: https://www.koyeb.com/docs/faqs/pricing
- Deno Deploy button: https://docs.deno.com/deploy/reference/button/
- Deno KV: https://docs.deno.com/deploy/reference/deno_kv/

## Recommendation

Build a **Netlify deployment target first**.

Expected end-user flow for a newly created Netlify account:

1. Click **Deploy to Netlify** in the README.
2. Sign in to Netlify/GitHub and approve the cloned project.
3. Wait for build and open the generated private `netlify.app` URL.
4. Sign in with the same Netlify account when Netlify requests visitor authentication.
5. Connect ChatGPT/Codex in the dashboard and paste the localhost callback URL as already supported.

There is no separate dashboard registration or password. Netlify owns the visitor session, and the user's project, storage, OAuth records, and scheduled refresh are isolated in their account.

Before promising this publicly, implement a minimal Netlify branch and verify four facts with a real Free account:

- a Deploy Button project from a new team is private by default;
- same-origin API calls work behind Netlify team login;
- Blobs state survives deploys and conditional writes prevent refresh races;
- measured five- or ten-minute refresh usage stays comfortably below 300 monthly credits.
