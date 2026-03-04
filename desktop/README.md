# openmud Desktop

Desktop app that loads openmud.ai. Built with Electron.

## Local dev

**Full stack (matches production):**
```bash
npm run dev
```
Runs vercel dev + desktop. Desktop loads localhost:3947. Add `OPENAI_API_KEY` to `web/.env`.

**Desktop only** (hits production API):
```bash
cd desktop && npm start
```

## Build .dmg (macOS only)

```bash
npm run build:dmg
```

Output: `dist/mudrag-1.0.0.dmg`

## CI

GitHub Actions builds the .dmg on release. See `.github/workflows/desktop.yml`.
