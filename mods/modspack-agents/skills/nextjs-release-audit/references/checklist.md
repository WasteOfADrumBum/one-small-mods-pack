# Next.js release checklist

- [ ] `productionBrowserSourceMaps` is not `true` (or the maps are meant to be public).
- [ ] No secret-looking `NEXT_PUBLIC_*` variable (`*_SECRET`, `*_KEY` for private APIs, `*_TOKEN`, `*_PASSWORD`).
- [ ] `headers()` in next.config (or the platform) sets Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options, Referrer-Policy and frame-ancestors.
- [ ] Every Server Action and Route Handler checks the session and authorization itself; middleware is not the only check.
- [ ] `middleware` matcher covers every protected path, including API routes and `/_next/data`.
- [ ] `images.remotePatterns` lists specific hosts; no `**` wildcard hostname.
- [ ] Personalised pages and route handlers opt out of static caching (`dynamic = 'force-dynamic'`, `cache: 'no-store'`, `revalidate = 0`) or vary correctly.
- [ ] `redirect()` and `NextResponse.redirect` targets from user input are validated.
- [ ] `dangerouslySetInnerHTML` only with sanitized content.
- [ ] Error pages (`error.tsx`, `_error`) show no stack traces in production.
- [ ] `next build` has no warnings about large pages or missing static generation that were not expected.
- [ ] `app/robots.ts` / `sitemap` correct for the environment (preview deployments not indexed).
