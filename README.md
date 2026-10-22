# FDA Recall Bot

A Telegram bot that sends you a daily or weekly report of new FDA recalls, with FDA's product photos, for the things you care about: groceries, pet food, supplements, baby food, cosmetics, or drugs and devices. A scheduled job collects the recalls from FDA.gov every 6 hours, and a free Cloudflare Worker sends the reports. Official public data only: every record keeps its source, link and retrieval time.

**Try it:** [web report](https://el9995.github.io/FDA-Recall-Bot/) · [bot simulator](https://el9995.github.io/FDA-Recall-Bot/bot/sim.html) (the full conversation in your browser, no Telegram account needed)

## What's here

- **Telegram bot (`bot/`):** open the bot, pick Daily or Weekly and which recalls, and get a short report: every recall linked to its FDA notice, an album of FDA's product photos, and a slide deck of every recall that opens inside Telegram. Runs free on Cloudflare Workers. Setup steps in `bot/SETUP.md`.
- **Recall report (home page):** daily or weekly report of new FDA recall notices, with the product photos FDA publishes. Visitors pick the FDA product types they care about (saved in their browser) and read it as a list or as slides. One RSS feed per product type in `feeds/`.
- **Barcode check (`check.html`, test):** type or scan a barcode to see the product from USDA FoodData Central and any matching FDA recall from openFDA.

## How the data updates

`scripts/fetch_recalls.py` runs in GitHub Actions every 6 hours (`.github/workflows/pages.yml`). It reads FDA's [Recalls, Market Withdrawals, & Safety Alerts](https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts) table and each new notice page (for photos), plus [Major Product Recalls](https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/major-product-recalls), then commits `data/recalls.json` and `feeds/` and republishes the site. It waits 2 seconds between requests, as FDA's robots.txt asks. Each record keeps its source, source link, retrieval time and "confirmed" status. Photos are linked from FDA.gov, not copied.

Run it locally with `python3 scripts/fetch_recalls.py` (standard library only).

## Data sources

- [USDA FoodData Central API](https://fdc.nal.usda.gov/api-guide) (free key from api.data.gov; the page falls back to the shared `DEMO_KEY`)
- FDA recall notices and Major Product Recalls pages on FDA.gov (see above)
- [openFDA food enforcement reports](https://open.fda.gov/apis/food/enforcement/) (no key, updated weekly)

Recall notices write barcodes in many formats, so barcode matching can miss recalls. The page always says so and links to FDA.gov and FSIS.usda.gov.

## Roadmap

1. Food recall check by barcode (add USDA FSIS recalls and FDA same-day announcements)
2. Plant-code lookup for meat (EST), milk, eggs and shellfish
3. Origin explainer pages (country-of-origin rules, "Product of USA")
4. Pantry recall alerts, shared with the Neuro Stack Atlas supplement stack alerts

No build step. Open `index.html` through any local web server to preview.

## How it was made

This project was **built with AI under my direction.** Claude (Anthropic's AI coding assistant) wrote the code. I set the product direction, chose the data sources, and made the privacy and accuracy calls: the bot stores only a Telegram chat ID and settings, and never rewords FDA's facts.
