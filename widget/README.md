# iPhone widget

iOS doesn't let a home-screen web app publish widgets, so the widget is rendered by
[Scriptable](https://apps.apple.com/app/scriptable/id1405459188) (free, no Apple Developer
account) and fed by a new endpoint, [`api/summary.js`](../api/summary.js).

`api/summary.js` recomputes the two headline KPIs server-side — the same calculation as
`stats` in [`src/App.jsx`](../src/App.jsx) — so the widget shows fresh prices even when the
app hasn't been opened. Where a price fetch fails it falls back to the price the app last
wrote to `cache/marketData`, which also preserves manual price overrides.

## 1. Create a Firebase service account

The endpoint reads your holdings out of Firestore directly, which needs admin credentials.

1. Firebase console → ⚙︎ Project settings → **Service accounts** → **Generate new private key**.
2. You get a JSON file. Collapse it to a single line:

```bash
cat ~/Downloads/myportfolio-tracker-*.json | jq -c .
```

Keep that file out of the repo — it grants full access to the project.

## 2. Find your user id

Firebase console → **Authentication** → Users → copy the **User UID** of your Google account.

## 3. Generate a widget token

```bash
openssl rand -hex 32
```

## 4. Set the environment variables in Vercel

Project → Settings → Environment Variables (Production):

| Name | Value |
| --- | --- |
| `WIDGET_TOKEN` | the random hex string from step 3 |
| `FIREBASE_SERVICE_ACCOUNT` | the single-line JSON from step 1 |
| `PORTFOLIO_UID` | the uid from step 2 |
| `PORTFOLIO_APP_ID` | optional — only if you overrode the default `portfolio-tracker-pro-v3` |

Redeploy so the new variables and the `firebase-admin` dependency take effect.

## 5. Check the endpoint

```bash
curl -s "https://YOUR-APP.vercel.app/api/summary?key=YOUR_TOKEN" | jq
```

Expected shape:

```json
{
  "totalILS": 412300,
  "totalUSD": 109946,
  "totalChangeILS": 38210,
  "totalChangePct": 10.21,
  "dailyChangeILS": -1240,
  "dailyChangePct": -0.3,
  "usdRate": 3.75,
  "holdingsCount": 14,
  "priceFailures": [],
  "asOf": "2026-08-17T09:12:04.118Z"
}
```

The numbers should match the top card in the app. `priceFailures` lists symbols that
neither fetched nor had a cached price — those are counted at their average cost.

Anyone holding the token can read these totals, so treat it like a password. To rotate it,
change `WIDGET_TOKEN` in Vercel and re-enter it in Scriptable (step 6).

## 6. Install the widget

1. Install Scriptable from the App Store.
2. In [`portfolio-widget.js`](portfolio-widget.js), replace `YOUR-APP.vercel.app` in
   `ENDPOINT` and `APP_URL` with your real domain.
3. Scriptable → **+** → paste the whole script → name it `MyWealth`.
4. Run it once inside Scriptable (▶). It prompts for the token and stores it in the
   device Keychain, then shows a preview of the widget.
5. Home screen → long press → **+** → Scriptable → pick a small or medium widget →
   long press the placed widget → **Edit Widget** → Script: `MyWealth`.

Two things worth knowing:

- Instead of the Keychain you can paste the token into the widget's **Parameter** field.
  That takes precedence, but it's stored in plain text in your home-screen layout.
- Tapping the widget opens the site in Safari, not the home-screen web app — iOS
  doesn't route external URLs into an installed PWA.

The same script also works as a lock-screen widget (Rectangular), where it renders a
compact three-line version.

## Refresh cadence

iOS decides when to refresh widgets from a system-wide budget; the script asks for 15
minutes, and in practice you get roughly that when you use the widget, less when you
don't. There is no way to force real-time updates from a widget. For move alerts, extend
[`api/telegram-notify.js`](../api/telegram-notify.js) instead.

## Timezone note

The daily-change reset (09:30, and the "—" on Sat/Sun) is evaluated in `Asia/Jerusalem`
in `api/summary.js`, because Vercel functions run in UTC. The app itself uses the device
clock, so the two agree as long as your phone is on Israel time.
