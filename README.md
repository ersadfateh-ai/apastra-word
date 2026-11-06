# Apastra Word

Apastra Word is an offline-first English–Persian vocabulary app. The current visual layout and theme system are intentionally preserved.

## What this edition changes

- Keeps the existing site appearance, navigation, dashboard, and simple statistics layout.
- Removes FSRS scheduling and all Again / Hard / Good / Easy rating controls.
- Simplifies Review to a word list: see the word and meaning, then press **Next word** (or Space / →).
- Keeps local IndexedDB storage for cards, categories, profile, review history, and dictionary cache.
- Improves dictionary lookup with punctuation cleanup, common inflection fallbacks, Persian-to-English translation, and spelling suggestions when available.
- Adds optional Supabase email/password accounts and cloud merge/sync. Existing local cards are merged rather than intentionally cleared on first account sync.
- Hardens the React UI against runtime crashes and replaces the previous broad Service Worker cache behavior.
- Adds Vercel SPA routing configuration.

## Deploy to Vercel

1. Push this folder to your GitHub repository.
2. Import that repository in Vercel.
3. Framework preset: **Vite**. Build command: `npm run build`. Output directory: `dist`.
4. Deploy. The app works locally in the browser without cloud credentials.

## Enable permanent cloud storage (optional but recommended)

1. Create a Supabase project.
2. In Supabase → SQL Editor, run the complete contents of `supabase/schema.sql`.
3. In Supabase → Authentication → URL Configuration, add your Vercel production URL to Site URL / Redirect URLs.
4. In Vercel → Project → Settings → Environment Variables, add:
   - `VITE_SUPABASE_URL` = Supabase Project URL
   - `VITE_SUPABASE_ANON_KEY` = Supabase anon/publishable key
5. Redeploy Vercel.
6. Open Apastra Word → Settings → Cloud account. Create an account, confirm the email if required, then sign in. The first sign-in merges local and cloud records. Later changes sync in the background; **Sync now** also pulls data from other devices.

Never expose a Supabase `service_role` or secret key in Vercel client environment variables, source code, GitHub, or chat. Only use the public anon/publishable key with Row Level Security enabled.

## Dictionary

The dictionary uses the Free Dictionary API and MyMemory translation service, with Datamuse spelling suggestions. Public free services can rate-limit requests or lack rare/proper nouns, specialist terminology, and some inflected forms. Previously searched entries are cached locally for offline access. A failed online lookup does not delete saved flashcards.

## Important data notes

- Without Supabase credentials and a signed-in account, data is saved only in that browser's IndexedDB. Clearing browser site data can remove local-only records; export a JSON backup periodically.
- With Supabase configured and the account signed in, card/category/review data syncs to that user's cloud tables under Row Level Security.
- The cloud merge is additive on first sync; it does not run a destructive replace of the cloud collection.
- Account signup may require email confirmation depending on Supabase Auth settings.

## Local development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```
