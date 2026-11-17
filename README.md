# Token Launch Radar

A radar for protocols that record no token yet, ranked by what their launch
would be worth if their record stayed as it is. Built for make.fun's
token-radar-01 competition. It never predicts whether or when a token
launches.

## Run it

Node 22.18 or later, standard library only, no network:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

`main.ts` reads the sealed snapshot, writes `board.json` and `data.js`,
copies `dashboard/` and `screenshots/` to the output directory, and writes
`dossier.json` with the vendored `buildDossier`. It runs twice in the
grader and both runs write the same bytes: the sort is a total order and
nothing reads the clock or random state.

## The model

```
implied value = TVL × category multiple × growth × age × chains
```

- **Category multiple.** The median market-cap-to-TVL ratio of the
  protocols in the same category whose token already trades, winsorized
  to [0.01, 2.0] and shrunk toward the global median (k = 6). A category
  with fewer than two comps takes the global median outright: a lone
  comp is not a market.
- **Growth.** The 7-day TVL change, clamped to [-80, +200] and passed
  through `1 + 0.3·tanh(x/50)`, so one wild week cannot own the board.
- **Age.** A seasoning premium for running longer with no token, rising
  toward 1.15 and easing back toward 1.00 after year two. Unknown
  listing dates stay neutral.
- **Chains.** A log premium for multi-chain reach, capped at 1.10.

Tokened protocols never appear on the board; they serve only as
valuation comps. The board holds every pre-token protocol that passes
the launch screen: 198 rows on this snapshot, covering all 40 watchlist
protocols.

## The screen

Wrapped, staked, bridged and exchange products are set aside, not
ranked — mirroring the house watchlist rule from the snapshot's own
fields (category, version-marker names, wrapped/staked words, exchange
name prefixes). 144 protocols are set aside on this snapshot, each with
its reason, listed in the dashboard's "Set aside" section.

## Farm plans

Each row carries five steps from a template keyed by the snapshot's
category (never by protocol name), naming the protocol and its primary
chain, with cost estimates and durations, ending with an honesty check:
no token is confirmed for any protocol here.

## Limits, stated plainly

The snapshot carries no yield, no per-chain TVL and no launch history,
so the model uses only what the snapshot holds. "Records no token"
means the record carries no token. Market caps are the snapshot's own
figures; no fully-diluted values exist to standardize against. An
implied value is a conditional claim, never a launch prediction.

## Layout

- `main.ts` — entrypoint: read, score, validate, write.
- `lib/radar.ts` — the model, the screen, the farm plans, the board build.
- `dashboard/` — the static page (no network): `index.html`, `radar.css`,
  `radar.js`. It reads `data.js`, written beside it by `main.ts`.
- `screenshots/` — the board, a detail view, and a filtered view.
- `vendor/makefun-board.ts` — the kit's dossier library, vendored.
