# CR Analytics — Circuit Runners FRC 1002

Analytics dashboard for Circuit Runners FRC 1002, covering the 2026 FRC district season.

## Live site
`https://cr-analytics.vercel.app` *(update after first deploy)*

---

## Refresh match data

When new events complete, run:

```bash
npm install
node scripts/refresh-data.js YOUR_TBA_API_KEY
git add public/data.json
git commit -m "refresh data"
git push
```

Vercel auto-redeploys in ~60 seconds.

---

## Project structure

```
cr-analytics/
├── public/
│   ├── index.html    ← Dashboard app
│   └── data.json     ← Match data (refreshed via script)
├── scripts/
│   └── refresh-data.js
├── package.json
├── vercel.json
└── .gitignore
```
