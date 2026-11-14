# Odds engine

Every market on Northeside shows odds from the first minute a matchweek opens. They are for
information and fun only: nobody stakes anything and points are not paid at odds (scoring rules are
fixed on-chain per matchweek).

## Model (`packages/odds`)

Dixon–Coles Poisson model, the standard approach for football scores:

- Each team has an **attack** and a **defence** strength, plus a **home advantage** and a base rate:
  home goals ~ Poisson(exp(mu + home + attack[h] − defence[a])), away goals ~ Poisson(exp(mu + attack[a] − defence[h])).
- Fitted by weighted maximum likelihood on last season and this season's finished rounds; a match
  365 days old counts half as much. A ridge prior pulls teams with little data towards a prior mean;
  promoted teams (not in last season's results) start a little below average.
- The score grid (0–0 to 9–9) uses the Dixon–Coles low-score correction (rho = −0.08) and is
  normalised to 1. Every market is read from it: 1X2, Double Chance, Over/Under 2.5, GG/NG and
  Correct Score.
- **Crowd blend**: once 5 wallets have sealed, the crowd's picks are blended in, each pick counting
  as one observation against 30 pseudo-observations from the model, so the odds move like a market.
- **Fair odds** = 1 ÷ probability, rounded down to 2 decimals, between 1.01 and 500. No margin.

## Data and refresh

Results come from TheSportsDB (free, one request per round; completed rounds are cached for good).
The worker refits every 6 hours and stores expected goals per fixture for matchweeks that have not
locked; odds freeze at lock. Team names are matched across providers with the same normalisation
used for results (`teamKey`).

## Backtest (this season, matchweeks 1–10)

Each round predicted using only results from before it (100 games):

| | Model | Baseline (last season's home/draw/away rates) |
| --- | --- | --- |
| Log loss (lower is better) | **1.026** | 1.081 |
| Brier score (lower is better) | **0.614** | 0.655 |
| Favourite won | 46% | |

Calibration: predicted 20–40% happened 28.4% of the time (predicted 28.4%), 40–60% happened 46.6%
(predicted 47.2%). The settings are not sensitive: across half-lives of 90–365 days, prior variances
0.08–0.3 and promoted-team priors −0.15 to −0.35, log loss stayed between 1.022 and 1.026.
