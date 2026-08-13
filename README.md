# MLB Prediction Bot

Automates daily MLB database updates and prediction generation on Lines.com WordPress.

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env
# edit .env with WP_USER / WP_PASS
```

## Run

```bash
npm start
```

Runs:
1. Database update (stadiums, standings, teamseason, games, playerseason → gameinfo → boxscore)
2. Generate predictions for today's games (Pacific time)

## Scripts

- `npm start` — full pipeline
- `npm run update-mlb` — database update only
- `npm run generate-predictions` — predictions only

## Schedule (Windows)

Task Scheduler task `MLBPredictionBot` runs `scripts/run-daily.ps1` daily at 7:30 AM Pacific.
