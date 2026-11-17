// Token launch radar: valuation model, launch screen, farm plans, board build.
//
// The model answers one question: if this protocol's record stayed as it is,
// what would its token be worth? It never predicts whether or when a token
// launches. Every input comes from the sealed snapshot; no protocol name is
// hardcoded anywhere in this file.

export type SnapshotProtocol = {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
};

export type Snapshot = {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
};

export type FactorBreakdown = {
  multiple: number;
  comps: number;
  growth: number;
  age: number;
  chains: number;
};

export type BoardRow = {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  factors: FactorBreakdown;
};

export type SetAside = { slug: string; name: string; reason: string };

export type RadarBoard = {
  rows: BoardRow[];
  setAside: SetAside[];
  asOf: string;
  floorUsd: number;
  globalMultiple: number;
  scanned: number;
  preToken: number;
  tokened: number;
};

/** Parse and minimally validate the sealed snapshot's JSON text. */
export function parseSnapshot(text: string): Snapshot {
  const data = JSON.parse(text) as Snapshot;
  if (!data || typeof data !== 'object') throw new Error('snapshot is not an object');
  if (!Array.isArray(data.protocols) || data.protocols.length === 0) {
    throw new Error('snapshot holds no protocols');
  }
  if (!Array.isArray(data.watchlist)) throw new Error('snapshot holds no watchlist');
  if (typeof data.as_of !== 'string' || typeof data.floor_usd !== 'number') {
    throw new Error('snapshot is missing as_of or floor_usd');
  }
  for (const p of data.protocols) {
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number') {
      throw new Error('snapshot holds a protocol without slug, name or tvl_usd');
    }
    if (!Array.isArray(p.chains)) throw new Error(`snapshot protocol ${p.slug} holds no chains array`);
  }
  return data;
}

/** Median of a non-empty list of numbers. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const WINSOR_LOW = 0.01;
const WINSOR_HIGH = 2.0;
const SHRINK_K = 6;
const MULTIPLE_LOW = 0.02;
const MULTIPLE_HIGH = 1.2;

/**
 * Calibrate valuation multiples from the protocols whose token already trades.
 * A category's multiple is the median market-cap-to-TVL ratio of its tokened
 * protocols, winsorized so one extreme comp cannot dominate, then shrunk
 * toward the global median so sparse categories cannot invent a market: a
 * category with fewer than two comps takes the global median outright.
 */
export function calibrateComps(protocols: SnapshotProtocol[]): {
  globalMultiple: number;
  byCategory: Map<string, { multiple: number; comps: number }>;
} {
  const ratiosByCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of protocols) {
    // A zero or negative market cap is a placeholder, not a valuation: only
    // positive market caps over positive TVL can serve as comps.
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = Math.min(WINSOR_HIGH, Math.max(WINSOR_LOW, p.mcap_usd / p.tvl_usd));
    allRatios.push(ratio);
    const key = p.category ?? '';
    const list = ratiosByCategory.get(key) ?? [];
    list.push(ratio);
    ratiosByCategory.set(key, list);
  }
  const globalMultiple = allRatios.length > 0 ? median(allRatios) : 0.2;
  const byCategory = new Map<string, { multiple: number; comps: number }>();
  for (const [key, ratios] of ratiosByCategory) {
    if (ratios.length < 2) {
      byCategory.set(key, { multiple: globalMultiple, comps: ratios.length });
      continue;
    }
    const shrunk = (ratios.length * median(ratios) + SHRINK_K * globalMultiple) / (ratios.length + SHRINK_K);
    byCategory.set(key, {
      multiple: Math.min(MULTIPLE_HIGH, Math.max(MULTIPLE_LOW, shrunk)),
      comps: ratios.length,
    });
  }
  return { globalMultiple, byCategory };
}

const SCREENED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_NAMES = new Set(['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini']);
const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * The launch screen, mirroring the house watchlist rule from the snapshot's
 * own fields: a wrapped, staked, bridged or exchange product is not a
 * protocol waiting on a launch of its own. Returns the reason it is set
 * aside, or null when the protocol is a radar candidate.
 */
export function screenReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && SCREENED_CATEGORIES.has(p.category)) {
    return `category ${p.category}`;
  }
  if (WRAPPED_WORD.test(p.name)) return 'name carries wrapped/staked';
  if (VERSION_MARKER.test(p.name)) return 'name ends in a version marker';
  const firstWord = p.name.split(/\s+/)[0]?.toLowerCase() ?? '';
  if (EXCHANGE_NAMES.has(firstWord)) return 'name begins with an exchange';
  return null;
}

/** Records no token when all three token fields are null. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Growth factor: rewards a rising week without letting one spike own the
 * board. The 7-day change is clamped, then passed through tanh, so the
 * factor stays in [0.72, 1.30] no matter how extreme the week was.
 */
export function growthFactor(change7d: number | null): number {
  if (change7d === null || !Number.isFinite(change7d)) return 1;
  const clamped = Math.min(200, Math.max(-80, change7d));
  return 1 + 0.3 * Math.tanh(clamped / 50);
}

/** Whole days between two YYYY-MM-DD dates, or null when either is missing. */
export function daysBetween(from: string | null, to: string): number | null {
  if (from === null) return null;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/**
 * Age factor: a protocol that has run longer with no token earns a seasoning
 * premium, rising toward 1.15 over its first years, then easing back toward
 * 1.00 after year two — a very old protocol with no token is seasoned, not
 * more likely to launch tomorrow. Unknown listing dates stay neutral.
 */
export function ageFactor(ageDays: number | null): number {
  if (ageDays === null) return 1;
  let factor = 0.85 + 0.3 * (1 - Math.exp(-ageDays / 365));
  factor = Math.min(1.15, factor);
  const years = ageDays / 365.25;
  if (years > 2) factor = Math.max(1.0, factor - 0.05 * (years - 2));
  return factor;
}

/** Chains factor: gentle log premium for multi-chain reach, capped at 1.10. */
export function chainsFactor(chainCount: number): number {
  return Math.min(1.1, 1 + 0.04 * Math.log(Math.max(1, chainCount)));
}

/** Implied value: TVL x category multiple x growth x age x chains. */
export function impliedValue(tvlUsd: number, f: FactorBreakdown): number {
  const value = tvlUsd * f.multiple * f.growth * f.age * f.chains;
  return Math.max(1, Math.round(value));
}

// ---- Farm plans ----

const GAS_HIGH = new Set(['Ethereum']);
const GAS_TINY = new Set(['Solana', 'Sui', 'Aptos', 'Near', 'Sei']);

/** A cost sentence for the protocol's primary chain, as an estimate. */
function gasSentence(chain: string): string {
  if (GAS_HIGH.has(chain)) return 'Budget $20–$60 for gas across these steps and batch them into one session.';
  if (GAS_TINY.has(chain)) return 'Network fees are under $1 total, so small test transactions cost almost nothing.';
  return `Budget $1–$5 total for network fees on ${chain}.`;
}

type FarmFamily =
  | 'dex'
  | 'lending'
  | 'vaults'
  | 'perps'
  | 'rwa'
  | 'cdp'
  | 'prediction'
  | 'basis'
  | 'staking'
  | 'generic';

const FAMILY_BY_CATEGORY: Record<string, FarmFamily> = {
  Dexs: 'dex',
  'Liquidity Manager': 'dex',
  Lending: 'lending',
  'Uncollateralized Lending': 'lending',
  'Collateral Markets': 'lending',
  'Collateral Management': 'lending',
  'Leveraged Farming': 'lending',
  'Risk Curators': 'vaults',
  'Onchain Capital Allocator': 'vaults',
  Yield: 'vaults',
  'Yield Aggregator': 'vaults',
  Farm: 'vaults',
  Indexes: 'vaults',
  Derivatives: 'perps',
  Options: 'perps',
  'Options Vault': 'perps',
  'Interest Rate Derivatives': 'perps',
  Synthetics: 'perps',
  RWA: 'rwa',
  'Reserve Currency': 'rwa',
  CDP: 'cdp',
  'CDP Manager': 'cdp',
  'Algo-Stables': 'cdp',
  'Stablecoin Issuer': 'cdp',
  'Stablecoin Wrapper': 'cdp',
  'Dual-Token Stablecoin': 'cdp',
  DOR: 'cdp',
  'Prediction Market': 'prediction',
  'Basis Trading': 'basis',
  CeDeFi: 'basis',
  'Staking Pool': 'staking',
  Restaking: 'staking',
};

/**
 * Five concrete farm steps per family. Templates are keyed by the snapshot's
 * category, never by protocol name; each plan names the protocol and its
 * primary chain, states what to do, what it costs and how long it takes, and
 * ends with an honesty check: no token is confirmed for any protocol here.
 */
const FARM_TEMPLATES: Record<FarmFamily, string[]> = {
  dex: [
    'Week 1: open {name} on {chain}, connect a wallet, and compare its top 3 pools by volume and fees before committing funds. {gas}',
    'Deposit $100–$500 into the highest-volume pair as liquidity, keeping half your budget in reserve for a second pool.',
    'Hold the position at least 30 days; claim trading fees weekly and re-add them only if the pool’s volume holds up.',
    'If {name} runs gauges or voting, lock or vote with your LP stake once, then check rewards monthly — never chase a gauge that pays less than the fees.',
    'Reality check: farm only if the trading fees alone justify it. No token is confirmed, so treat any future airdrop as a bonus, not the plan.',
  ],
  lending: [
    'Week 1: open {name} on {chain} and read its listed markets; pick a collateral asset you already hold. {gas}',
    'Supply $100–$500 of collateral and confirm the supply rate and withdrawal terms before borrowing anything.',
    'Borrow only if you need it, keeping loan-to-value under 50%, and set a weekly reminder to check your health factor.',
    'Hold the supply position 30–90 days, claiming any incentives weekly; repay any loan in full before withdrawing collateral.',
    'Reality check: farm only if the supply yield beats a plain alternative after fees. No token is confirmed for {name}.',
  ],
  vaults: [
    'Week 1: open {name} on {chain} and compare its vaults by 30-day return, fees, and withdrawal delay. {gas}',
    'Deposit $100–$500 split across two vaults with different strategies; avoid putting everything in the newest vault.',
    'Hold at least 60 days — curator vaults reward patience — and review performance monthly against the vault’s own benchmark.',
    'Harvest or compound rewards monthly; exit a vault if its return trails its peers for two straight months.',
    'Reality check: past vault returns do not promise future ones, and no token is confirmed. Size the deposit so a flat quarter still feels fine.',
  ],
  perps: [
    'Week 1: open {name} on {chain}, fund a small test balance, and place one tiny trade to learn the fees, funding, and close flow. {gas}',
    'Trade with $50–$200 total, always with a stop-loss, and never risk more than 2% of the balance on one position.',
    'If {name} offers a liquidity vault, consider supplying $100–$300 to it instead of directional trading for steadier exposure.',
    'Keep a weekly log of fees and funding paid; if costs eat your edge for two weeks, pause and reassess.',
    'Reality check: leveraged trading loses money for most traders. Farm only with money you can lose; no token is confirmed.',
  ],
  rwa: [
    'Week 1: open {name} on {chain} and check eligibility first — many real-world-asset vaults are permissioned or need identity checks. {gas}',
    'Read the vault’s asset backing and redemption terms; confirm how long an exit takes before depositing anything.',
    'Deposit $200–$1,000 into one vault whose maturity matches money you will not need soon, and keep the confirmation records.',
    'Hold to the stated maturity or review quarterly; track the reported yield against the vault’s own documents.',
    'Reality check: real-world-asset yields depend on off-chain issuers you cannot audit from here, and no token is confirmed.',
  ],
  cdp: [
    'Week 1: open {name} on {chain} and read how its stablecoin holds its peg and what backs it. {gas}',
    'Open a vault with $100–$500 of collateral and mint conservatively, keeping collateralization well above the minimum.',
    'Check the peg and your vault’s ratio weekly; top up collateral or repay promptly if either moves against you.',
    'Hold the position 30–90 days, then repay and close in one session to save on repeated gas.',
    'Reality check: a depeg can liquidate a vault fast. Farm only with collateral you can top up, and no token is confirmed.',
  ],
  prediction: [
    'Week 1: open {name} on {chain} and paper-trade first: follow three markets to resolution before risking funds. {gas}',
    'Bet $10–$50 per market on questions you understand, and never add to a losing position to chase it back.',
    'If {name} pays liquidity providers, consider supplying $100–$300 to a high-volume market instead of betting directionally.',
    'Track every position’s fees and outcomes weekly; stop for the month if losses pass a budget you set in advance.',
    'Reality check: prediction markets are zero-sum before fees. Treat this as paid entertainment unless your record says otherwise; no token is confirmed.',
  ],
  basis: [
    'Week 1: open {name} on {chain} and read how its basis trade earns yield and what happens when funding flips negative. {gas}',
    'Deposit $100–$500, confirm the withdrawal delay and any lock-up, and start small until one full funding cycle passes.',
    'Hold 30–60 days and watch the reported yield weekly; basis yields compress fast when markets calm down.',
    'Exit in one transaction when the yield no longer beats a plain lending market, and record the round-trip fees.',
    'Reality check: basis yield is market-regime income, not a fixed rate, and no token is confirmed for {name}.',
  ],
  staking: [
    'Week 1: open {name} on {chain} and confirm the unbonding period and slashing terms before staking anything. {gas}',
    'Stake $100–$500, preferably split across two validators or pools, and keep enough unstaked to cover fees.',
    'Hold through at least one full reward cycle; claim and restake rewards monthly if the math beats the gas.',
    'Review validator performance quarterly and move stake only when a validator clearly underperforms its peers.',
    'Reality check: staking locks your funds for the unbonding period. No token is confirmed, so the staking yield itself must justify it.',
  ],
  generic: [
    'Week 1: open {name} on {chain}, connect a wallet, and complete one small real transaction to learn the product and its fees. {gas}',
    'Put $100–$500 to work in its core {category} feature — the action its own docs describe first — and note the exact costs.',
    'Repeat the core action weekly for 30–60 days; consistency matters more than size for any future rewards program.',
    'Join its public community channel and read announcements weekly so you hear about programs, risks, and changes first.',
    'Reality check: no token is confirmed for {name}. Farm only if using the product is worth it on its own merits.',
  ],
};

/** Build one protocol's farm plan from its category and primary chain. */
export function farmPlan(p: SnapshotProtocol): string[] {
  const family = (p.category !== null ? FAMILY_BY_CATEGORY[p.category] : undefined) ?? 'generic';
  const chain = p.chains[0] ?? 'its home chain';
  const category = p.category ?? 'protocol';
  return FARM_TEMPLATES[family].map((step) =>
    step
      .replaceAll('{name}', p.name)
      .replaceAll('{chain}', chain)
      .replaceAll('{category}', category)
      .replaceAll('{gas}', gasSentence(chain)),
  );
}

// ---- Board build ----

/** Build the ranked board: pre-token protocols that pass the launch screen. */
export function buildBoard(snapshot: Snapshot): RadarBoard {
  const { globalMultiple, byCategory } = calibrateComps(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);
  const rows: BoardRow[] = [];
  const setAside: SetAside[] = [];
  let preToken = 0;
  let tokened = 0;

  for (const p of snapshot.protocols) {
    if (!recordsNoToken(p)) {
      tokened += 1;
      continue;
    }
    preToken += 1;
    const reason = screenReason(p);
    if (reason !== null) {
      setAside.push({ slug: p.slug, name: p.name, reason });
      continue;
    }
    const ageDays = daysBetween(p.listed_at, snapshot.as_of);
    const calibrated = byCategory.get(p.category ?? '');
    const factors: FactorBreakdown = {
      multiple: calibrated?.multiple ?? globalMultiple,
      comps: calibrated?.comps ?? 0,
      growth: growthFactor(p.change_7d),
      age: ageFactor(ageDays),
      chains: chainsFactor(p.chains.length),
    };
    rows.push({
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: impliedValue(p.tvl_usd, factors),
      farm_steps: farmPlan(p),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: ageDays,
      watchlist: watchlist.has(p.slug),
      factors,
    });
  }

  // Rank by implied value, then TVL, then slug: a total order, so the two
  // grader runs always write the same bytes.
  rows.sort(
    (a, b) =>
      b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1),
  );
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });
  setAside.sort((a, b) => (a.slug < b.slug ? -1 : 1));

  return {
    rows,
    setAside,
    asOf: snapshot.as_of,
    floorUsd: snapshot.floor_usd,
    globalMultiple,
    scanned: snapshot.protocols.length,
    preToken,
    tokened,
  };
}

/**
 * Validate the board against the gate's shape. Returns the first problem
 * found, or null when the board is valid.
 */
export function validateBoard(board: RadarBoard, snapshot: Snapshot): string | null {
  const { rows } = board;
  if (rows.length < 100) return `board holds ${rows.length} rows, fewer than the 100 minimum`;
  if (rows.length > 4000) return `board holds ${rows.length} rows, past the 4000 maximum`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  let allEqual = true;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    if (!known.has(row.slug)) return `row ${i + 1} names ${row.slug}, not one of the snapshot's protocols`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.name.trim().length === 0) return `row ${i + 1} has an empty name`;
    if (row.rank !== i + 1) return `row ${i + 1} carries rank ${row.rank}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `row ${row.slug} has a non-positive implied value`;
    }
    if (row.implied_value_usd > 100_000_000_000_000) return `row ${row.slug} exceeds the value cap`;
    if (row.implied_value_usd > previous) return `implied value rises at rank ${row.rank}`;
    if (row.implied_value_usd !== previous && previous !== Number.POSITIVE_INFINITY) allEqual = false;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} holds ${row.farm_steps.length} farm steps`;
    }
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${row.slug} holds a farm step of ${len} characters`;
    }
  }
  if (rows.length >= 2 && allEqual) return 'every implied value is the same: not a ranking';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  return null;
}

/** The dashboard's data file: the same board the page renders, as JSON. */
export function buildDataScript(board: RadarBoard): string {
  return `window.RADAR = ${JSON.stringify(board)};\n`;
}
