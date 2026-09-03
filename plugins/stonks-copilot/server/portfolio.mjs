/**
 * Portfolio ingestion and forensics. Parsing is tolerant: it accepts a
 * pasted CSV export from common brokers (Schwab positions export, generic
 * `symbol,quantity,cost` lists) and ignores header/summary noise rows.
 * Analysis merges direct holdings with fund constituents into effective
 * exposure, overlap, and concentration metrics. Pure — no I/O.
 */

const SYMBOL_RE = /^[A-Z][A-Z0-9.\-/]{0,11}$/u;

const HEADER_ALIASES = {
  symbol: ["symbol", "ticker", "security symbol", "symbol/name"],
  quantity: ["quantity", "qty", "shares", "quantity (s)", "share count"],
  costBasis: ["cost basis", "cost basis (s)", "cost per share", "avg cost", "average cost", "price paid", "purchase price"],
  price: ["price", "last price", "current price", "closing price", "last mark", "price as of date"],
  securityType: ["security type", "asset type", "type", "asset class"],
  expenseRatio: ["expense ratio", "net expense ratio", "er", "fee"],
};

const SKIP_ROW_PATTERNS = [
  /^(?:positions|account|cash|total|as of|metric|benchmark)/i,
  /total(?:\s+market|\s+account|\s+value|\s+cost|\s+gain|\s+loss)/i,
  /^["']?(?:cash|money market|sweep)/i,
];

/** Parse pasted positions text into a normalized portfolio. */
export function parsePositionsText(text) {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return { positions: [], warnings: ["no non-empty rows found"] };

  // Broker exports lead with prose ("Positions as of ...") before the real
  // header row; scan the first few lines for one that actually maps to
  // symbol+quantity columns instead of trusting line 1.
  let headerLine = -1;
  for (let i = 0; i < Math.min(lines.length, 6); i += 1) {
    const candidate = mapHeader(lines[i].split(detectDelimiter(lines[i])));
    if (candidate.symbol >= 0 && candidate.quantity >= 0) {
      headerLine = i;
      break;
    }
  }
  const warnings = [];
  let header;
  let rows;
  const delimiter = headerLine >= 0 ? detectDelimiter(lines[headerLine]) : ",";
  if (headerLine >= 0) {
    const headerText = lines[headerLine];
    header = mapHeader(headerText.split(detectDelimiter(headerText)));
    rows = lines.slice(headerLine + 1);
  } else {
    // Headerless paste: assume symbol,quantity[,cost]
    warnings.push("no recognizable header; assuming symbol,quantity[,cost basis]");
    header = mapHeader([]);
    rows = lines;
  }

  const positions = [];
  const skipped = [];
  for (const row of rows) {
    const cells = row.split(delimiter).map((cell) => cell.trim().replace(/^["']|["']$/gu, ""));
    const rawSymbol = header.symbol >= 0 ? cells[header.symbol] : cells[0];
    const symbol = normalizeSymbol(rawSymbol);
    if (symbol === null) {
      if (!SKIP_ROW_PATTERNS.some((pattern) => pattern.test(row))) skipped.push(row);
      continue;
    }
    const quantity = parseNumber(header.quantity >= 0 ? cells[header.quantity] : cells[1]);
    if (quantity === null || quantity === 0) {
      skipped.push(row);
      continue;
    }
    const costBasis = header.costBasis >= 0 ? parseNumber(cells[header.costBasis]) : parseNumber(cells[2]);
    const price = header.price >= 0 ? parseNumber(cells[header.price]) : null;
    const type = header.securityType >= 0 ? cells[header.securityType] : "";
    positions.push({
      symbol,
      quantity,
      costBasis,
      lastPrice: price,
      expenseRatioPct: header.expenseRatio >= 0 ? parsePercent(cells[header.expenseRatio]) : null,
      kind: classifyKind(symbol, type),
    });
  }
  if (positions.length === 0) {
    warnings.push("no position rows recognized; expected symbol + quantity columns");
  }
  if (skipped.length > 0) warnings.push(`${skipped.length} row(s) ignored as non-positions`);
  return { positions, warnings };
}

function detectDelimiter(line) {
  const counts = [
    { d: ",", n: countOutsideQuotes(line, ",") },
    { d: "\t", n: countOutsideQuotes(line, "\t") },
    { d: ";", n: countOutsideQuotes(line, ";") },
  ].sort((a, b) => b.n - a.n);
  return counts[0].n >= 1 ? counts[0].d : ",";
}

function countOutsideQuotes(line, needle) {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && line.startsWith(needle, i)) count += 1;
  }
  return count;
}

function mapHeader(cells) {
  const normalized = cells.map((cell) => cell.trim().toLowerCase().replace(/^"|"$/gu, ""));
  const find = (aliases) => {
    for (const alias of aliases) {
      const index = normalized.findIndex((cell) => cell === alias);
      if (index !== -1) return index;
    }
    for (const alias of aliases) {
      const index = normalized.findIndex((cell) => cell.startsWith(alias));
      if (index !== -1) return index;
    }
    return -1;
  };
  return {
    symbol: find(HEADER_ALIASES.symbol),
    quantity: find(HEADER_ALIASES.quantity),
    costBasis: find(HEADER_ALIASES.costBasis),
    price: find(HEADER_ALIASES.price),
    securityType: find(HEADER_ALIASES.securityType),
    expenseRatio: find(HEADER_ALIASES.expenseRatio),
  };
}

function normalizeSymbol(raw) {
  const cleaned = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/gu, "");
  if (!SYMBOL_RE.test(cleaned)) return null;
  if (/^[0-9]/u.test(cleaned)) return null;
  return cleaned;
}

function parseNumber(raw) {
  if (raw === undefined || raw === null) return null;
  const cleaned = String(raw).replace(/[$,\s]/gu, "").replace(/--/u, "");
  if (cleaned === "" || cleaned === "N/A") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function parsePercent(raw) {
  const value = parseNumber(String(raw ?? "").replace(/%/gu, ""));
  return value === null ? null : value;
}

function classifyKind(symbol, typeText) {
  const text = String(typeText ?? "").toLowerCase();
  if (/etf|fund|index|mutual/u.test(text)) return "fund";
  if (/cash|money|bond|fixed/u.test(text)) return "cash";
  const fundish = /^(?:SPY|VOO|QQQ|VTI|VT|IVV|DIA|IWM|EFA|VWO|AGG|BND|GLD|ARK[A-Z]?|SCH[DFB]|VXUS|VTV|VUG|VIG|IJR|iShares)/u;
  return fundish.test(symbol) ? "fund" : "stock";
}

/**
 * Merge direct positions with fund constituent weights (values 0-1 per
 * underlying) into effective exposure and overlap diagnostics.
 */
export function xrayPortfolio(positions, { constituentsOf, priceOf }) {
  const priced = positions.map((position) => {
    const price = position.lastPrice ?? priceOf(position.symbol) ?? null;
    const value = price !== null ? price * position.quantity : null;
    return { ...position, value };
  });
  const totalValue = priced.reduce((a, p) => a + (p.value ?? 0), 0);
  const valued = totalValue > 0 ? priced.filter((p) => p.value !== null) : priced;
  const base = totalValue > 0 ? totalValue : valued.reduce((a, p) => a + p.quantity, 0);
  if (base <= 0) return { error: "portfolio has no measurable value" };

  const exposure = new Map();
  const throughFunds = new Map();
  const direct = new Map();
  const unresolved = [];
  const annualFeeUsd = [];
  for (const position of valued) {
    const weight = (position.value ?? position.quantity) / base;
    const fee = position.expenseRatioPct;
    if (fee !== null && position.value !== null) annualFeeUsd.push((fee / 100) * position.value);
    if (position.kind === "fund") {
      const holdings = constituentsOf(position.symbol);
      if (holdings === null) {
        unresolved.push(position.symbol);
        bump(exposure, position.symbol, weight, { via: [position.symbol] });
        bump(direct, position.symbol, weight);
        continue;
      }
      for (const holding of holdings) {
        const effective = holding.weight * weight;
        bump(exposure, holding.symbol ?? holding.name, effective, {
          via: [position.symbol],
        });
        bump(throughFunds, holding.symbol ?? holding.name, effective, position.symbol);
      }
    } else {
      bump(exposure, position.symbol, weight, { via: [] });
      bump(direct, position.symbol, weight);
    }
  }

  const ranked = [...exposure.entries()]
    .map(([symbol, entry]) => ({
      symbol,
      weight: round4(entry.weight),
      via: [...entry.via],
      duplicatedViaFunds: round4((throughFunds.get(symbol)?.weight ?? 0) - (direct.get(symbol)?.weight ?? 0) > 0
        ? Math.min(throughFunds.get(symbol)?.weight ?? 0, entry.weight)
        : 0),
    }))
    .sort((a, b) => b.weight - a.weight);

  const hhi = ranked.reduce((a, item) => a + item.weight ** 2, 0);
  const top10 = ranked.slice(0, 10).reduce((a, item) => a + item.weight, 0);
  const fundWeight = valued
    .filter((p) => p.kind === "fund")
    .reduce((a, p) => a + (p.value ?? p.quantity) / base, 0);

  return {
    positionsCount: valued.length,
    totalValue: round2(totalValue),
    fundWeight: round4(fundWeight),
    stockWeight: round4(1 - fundWeight),
    effectiveExposure: ranked.slice(0, 25),
    concentration: {
      hhi: round4(hhi),
      top10Weight: round4(top10),
      interpretation:
        hhi > 0.25
          ? "highly concentrated"
          : hhi > 0.10
            ? "moderately concentrated"
            : "well diversified",
    },
    estimatedAnnualFeeUsd: round2(annualFeeUsd.reduce((a, f) => a + f, 0)),
    unresolvedFunds: unresolved,
  };
}

function bump(map, key, weight, extra = { via: [] }) {
  const entry = map.get(key) ?? { weight: 0, via: new Set() };
  entry.weight += weight;
  for (const via of extra.via ?? []) entry.via.add(via);
  map.set(key, entry);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}
