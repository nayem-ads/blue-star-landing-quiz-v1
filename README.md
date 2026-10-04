# Blue Star Adjusters: Quiz First landing page

This is the paid landing page for Google Ads (Quiz First, F1). On mobile the first screen is the first question. Leads are saved to Postgres and emailed to you.

- Node 20+, Express, no front-end framework. The page, script and logo are about 52 KB, or about 16 KB compressed, plus self-hosted fonts.
- Lighthouse mobile (local test): Performance 100, Accessibility 100, Best Practices 100. SEO shows low on purpose because the page is `noindex`, which keeps paid pages out of Google search.
- Tested at 360, 375, 390, 430 and 1280 px wide. There is no sideways scroll, all 4 answer tiles sit above the fold on every phone size, and inputs use 16 px text so iPhones don't zoom in.

## Deploy on Railway (about 10 minutes)

1. Push this folder to a new GitHub repo.
2. In Railway, create a **New Project**, choose **Deploy from GitHub repo** and pick the repo.
3. In the same project, choose **+ New**, then **Database**, then **Add PostgreSQL**.
4. Open the web service and go to **Variables**. Add:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`. Use Railway's reference picker so it links to the database.
   - `NOTIFY_TO` = `nayem.adsmanager@gmail.com`. You can add more addresses separated by commas, for example Mike's.
   - `ADMIN_KEY` = any long random text. This protects the CSV download and the test email.
   - Email: pick one of the two options below.
5. Go to **Settings**, then **Networking**, then **Generate Domain**. You can add a custom domain later, for example `review.bluestaradjusters.com`.
6. Open `https://YOUR-DOMAIN/health`. You should see `{"ok":true,"storage":"postgres"}`.
7. Open `https://YOUR-DOMAIN/admin/test-email?key=YOUR_ADMIN_KEY`. A test lead email should arrive.

Railway sets `PORT` itself. The health check is already set in `railway.json`. The database table is created automatically on the first start.

### Email option A: Resend (recommended)
1. Sign up at resend.com with **nayem.adsmanager@gmail.com**. The free plan covers 3,000 emails a month.
2. Create an API key.
3. In Railway, set `RESEND_API_KEY` = that key.

Alerts are sent from `onboarding@resend.dev` to your own address. Resend allows this without verifying a domain, as long as the alert goes to the email you signed up with. To send to other people (Mike), verify `bluestaradjusters.com` in Resend and set `EMAIL_FROM=Blue Star Leads <leads@bluestaradjusters.com>`.

### Email option B: FormSubmit (no account)
1. Leave `RESEND_API_KEY` empty.
2. Set `PUBLIC_URL` to your live address.
3. The first lead triggers an "Activate form" email from FormSubmit to `NOTIFY_TO`. Click it once and alerts flow after that.

Resend is more reliable for server-side sending. If FormSubmit ever refuses, switch to Resend.

If an email fails, the lead is still saved. Each row records `email_status` and `email_error`.

## What it does
- **Quiz:** loss type, then claim status, then date of loss, then name, mobile and ZIP, then a thank-you screen.
  - Each answer moves to the next step on its own.
  - The phone's Back button works step by step.
  - Answers survive a page reload.
- **Thank-you screen:** shows call times for the next 3 business days, 9 AM to 5 PM Pacific only. The time they pick is saved and emailed.
- **Ad matching:** the headline changes with `?loss=fire`, `?loss=smoke`, `?loss=water` or `?loss=denied`. Use these as the final URLs for each ad group.
- **Tracking:**
  - These values are saved with every lead: `utm_*`, `gclid`, `gbraid`, `wbraid`, `fbclid`, landing URL and referrer.
  - Set `GTM_ID` to load Google Tag Manager.
  - Events pushed to `dataLayer`: `quiz_start`, `quiz_answer`, `generate_lead` (use this one as the Google Ads and Meta conversion), `callback_booked`, `call_click`.
- **Spam guard:**
  - A hidden honeypot field.
  - Submissions faster than 3 seconds are flagged as spam.
  - 6 submissions per IP per 10 minutes.
  - The same phone within 30 minutes is treated as one lead.
  - Spam is saved with `is_spam=true` and doesn't send an email.
- **Leads CSV:** `https://YOUR-DOMAIN/admin/leads.csv?key=YOUR_ADMIN_KEY`.
- **Privacy notice:** at `/privacy`. The consent line sits under the submit button.

## Local run
```
npm install
cp .env.example .env   # optional; without DATABASE_URL leads go to data/leads.ndjson
npm start              # http://localhost:3000
BASE=http://localhost:3000 ADMIN_KEY=... npm test   # 16 checks
```

## Before ads go live (client to confirm)
- The "usually the same business day" call-back promise on the thank-you screen.
- Written consent for the three results shown: Palisades, smoke damage and estate fire.
- Legal review of the consent line (calls and texts) and the privacy notice.
- Who answers (916) 507-1005, and that the call-back slots match real availability.
