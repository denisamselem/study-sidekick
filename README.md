<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1wpFpWFhm-56cm2w8BS5RzUUPUzlITaHp

## Run Locally

**Prerequisites:** Node.js

### 1) Install dependencies
`npm install`

### 2) Configure environment variables

This project reads environment variables from the Vercel dashboard in production and supports local development via env files.

- For local development, create a new file at `api/.env.local` and add the following keys:

```bash
# Gemini
API_KEY=your_gemini_api_key

# Supabase (server)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key

# Client config provided by server endpoint /api/config
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
```

Note: env files are git-ignored. In production, set these in the Vercel project settings.

### 3) Run the app
`npm run dev`

The frontend runs on Vite and proxies API calls to `http://localhost:3001`.

### Run frontend and API together

You can start both servers with a single command from the project root:

```bash
npm run dev:all
```

This runs:
- `npm run dev --prefix api` (API, loads `api/.env.local` automatically)
- `npm run dev` (frontend)

Alternatively, run only the API:

```bash
npm run dev:api
```
