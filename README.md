# Prediction Bot (MLB, NBA, NHL, NFL)

Automates daily database updates and prediction generation on Lines.com WordPress.

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

Full daily order:
1. **MLB** database update → MLB generate predictions
2. **NBA** database update → NBA generate predictions
3. **NHL** database update → NHL generate predictions
4. **NFL** database update (one endpoint at a time) → NFL generate predictions

### MLB, NBA, and NHL update batches
- stadiums, standings, players, teamseason, games, playerseason
- gameinfo
- boxscore

### NFL update (one-by-one)
stadiums → standings → players → teamseason → timeframe → schedule → score → playerseason → bye → injury → rookies → gameinfo → boxscorev3

## Scripts

- `npm start` — full pipeline
- `npm run update-mlb` / `update-nba` / `update-nhl` / `update-nfl`
- `npm run generate-predictions` — predictions only (default MLB; set `LEAGUE=NBA`)

## Env flags

- `TARGET_DATE=YYYY-MM-DD` — override prediction day (default: Pacific today)
- `SKIP_UPDATE=1` — skip DB updates
- `SKIP_PREDICTIONS=1` — skip prediction clicks
- `SKIP_MLB=1` / `SKIP_NBA=1` / `SKIP_NHL=1` / `SKIP_NFL=1`
- `LEAGUE=NBA` — used when running generate-predictions alone

## Schedule (Windows)

Task Scheduler task `MLBPredictionBot` runs `scripts/run-daily.ps1` daily.
