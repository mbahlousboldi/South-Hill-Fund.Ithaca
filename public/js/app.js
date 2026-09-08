/* South Hill Fund — frontend
 * Fetches /api/holdings (static, from statements) and /api/quotes (live,
 * proxied server-side from Yahoo Finance), and renders:
 *   - the scrolling ticker tape
 *   - the three overview fund cards
 *   - a detail view per fund with a live holdings table
 */

const state = {
  holdings: null, // from /api/holdings
  quotes: {},     // symbol -> { price, change, changePercent } | null
  quotesAsOf: null,
  quotesSource: null,
};

const fmtUSD = (n) =>
  n == null || Number.isNaN(n)
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const fmtUSDCompact = (n) =>
  n == null || Number.isNaN(n) ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const fmtPct = (n) => (n == null || Number.isNaN(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);

const fmtLiveDate = (timestamp = Date.now()) => {
  const d = new Date(timestamp);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const fmtLiveTime = (timestamp = Date.now()) => {
  const d = new Date(timestamp);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};

const typeLabel = { equity: "Equity", etf: "ETF", reit: "REIT" };
const typeDot = { equity: "a-equity", etf: "a-etf", reit: "a-reit", cash: "a-cash", fixed: "a-fixed" };

// ---------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------

async function loadHoldings() {
  const res = await fetch("/api/holdings");
  state.holdings = await res.json();
}

async function loadQuotes() {
  try {
    const res = await fetch("/api/quotes");
    const json = await res.json();
    state.quotes = json.quotes || {};
    state.quotesAsOf = json.asOf;
    state.quotesSource = json.source;
  } catch (e) {
    console.warn("Could not load live quotes:", e);
  }
}

// ---------------------------------------------------------------
// Derived fund math
// ---------------------------------------------------------------

// Live (or fallback) market value of a single holding
function holdingValue(h) {
  const q = state.quotes[h.symbol];
  if (q && q.price != null) return q.price * h.qty;
  return null; // unknown — caller should fall back to statement total
}

function fundLiveValue(fund) {
  let liveTotal = fund.cash || 0;
  let knownCount = 0;

  for (const h of fund.holdings) {
    const v = holdingValue(h);
    if (v == null) continue;
    liveTotal += v;
    knownCount++;
  }
  if (fund.treasuries) {
    for (const t of fund.treasuries) liveTotal += t.marketValue;
  }

  const allKnown = knownCount === fund.holdings.length;
  const anyKnown = knownCount > 0;

  // If no live prices came back at all, use the statement's ending value
  // rather than a total that's really just cash + treasuries.
  const total = anyKnown ? liveTotal : fund.endingValue;

  return { total, allKnown, anyKnown };
}

function fundAllocation(fund) {
  const buckets = { equity: 0, etf: 0, reit: 0, fixed: 0, cash: fund.cash || 0 };
  for (const h of fund.holdings) {
    const v = holdingValue(h) ?? 0; // rough shares of allocation even before live price loads
    buckets[h.type] = (buckets[h.type] || 0) + v;
  }
  if (fund.treasuries) {
    buckets.fixed += fund.treasuries.reduce((s, t) => s + t.marketValue, 0);
  }
  const sum = Object.values(buckets).reduce((a, b) => a + b, 0) || 1;
  return { buckets, sum };
}

// ---------------------------------------------------------------
// Ticker tape
// ---------------------------------------------------------------

function allSymbols() {
  const set = new Set();
  for (const fund of Object.values(state.holdings.funds)) {
    fund.holdings.forEach((h) => set.add(h.symbol));
  }
  return [...set];
}

function renderTicker() {
  const track = document.getElementById("tickerTrack");
  if (!state.holdings) return;

  const symbols = allSymbols();
  const itemsHtml = symbols
    .map((sym) => {
      const q = state.quotes[sym];
      const price = q?.price;
      const chg = q?.changePercent;
      const dir = chg == null ? "flat" : chg > 0 ? "up" : chg < 0 ? "down" : "flat";
      const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "•";
      return `<span class="ticker-item">
        <span class="sym">${sym}</span>
        <span class="px">${price != null ? price.toFixed(2) : "—"}</span>
        <span class="chg ${dir}">${arrow} ${chg != null ? Math.abs(chg).toFixed(2) + "%" : ""}</span>
      </span>`;
    })
    .join("");

  // duplicate the sequence once so the marquee loop is seamless
  track.innerHTML = itemsHtml + itemsHtml;
}

// ---------------------------------------------------------------
// Overview
// ---------------------------------------------------------------

function renderOverview() {
  const funds = state.holdings.funds;
  const order = ["equity", "fixedIncome", "ctc"];

  let combined = 0;
  let anyFundKnown = false;
  let allFundsFullyKnown = true;

  order.forEach((id) => {
    const { total, allKnown, anyKnown } = fundLiveValue(funds[id]);
    combined += total;
    if (anyKnown) anyFundKnown = true;
    if (!allKnown) allFundsFullyKnown = false;
  });

  document.getElementById("combinedAum").textContent = fmtUSD(combined);
  const status = document.getElementById("marketStatus");
  const liveTimestamp = state.quotesAsOf || Date.now();
  const liveDate = fmtLiveDate(liveTimestamp);
  const liveTime = fmtLiveTime(liveTimestamp);
  document.getElementById("combinedDelta").textContent = !anyFundKnown
    ? `statement value · ${state.holdings.asOf}`
    : allFundsFullyKnown
    ? `live market values · ${liveDate} · ${liveTime}`
    : `partially live · ${liveDate} · statement ${state.holdings.asOf}`;
  if (status) {
    status.textContent = !anyFundKnown
      ? `Statement data · ${state.holdings.asOf}`
      : allFundsFullyKnown
      ? `Live quotes · ${liveDate} · ${liveTime}`
      : `Live quotes partially available · ${liveDate} · statement ${state.holdings.asOf}`;
  }

  const map = {
    equity: ["ovEquityValue", "ovEquityDelta"],
    fixedIncome: ["ovFiValue", "ovFiDelta"],
    ctc: ["ovCtcValue", "ovCtcDelta"],
  };
  order.forEach((id) => {
    const fund = funds[id];
    const { total } = fundLiveValue(fund);
    const [valueEl, deltaEl] = map[id];
    document.getElementById(valueEl).textContent = fmtUSD(total ?? fund.endingValue);
    const monthChange = fund.beginningValue != null ? total - fund.beginningValue : null;
    const el = document.getElementById(deltaEl);
    if (monthChange != null) {
      el.textContent = `${monthChange >= 0 ? "▲" : "▼"} ${fmtUSDCompact(Math.abs(monthChange))} this month`;
      el.className = `delta ${monthChange >= 0 ? "up" : "down"}`;
    }
  });

  renderFundGrid();
}

function allocLegendHtml(fund) {
  const { buckets, sum } = fundAllocation(fund);
  return Object.entries(buckets)
    .filter(([, v]) => v > 0.5)
    .map(([type, v]) => {
      const pct = ((v / sum) * 100).toFixed(0);
      const label = type === "fixed" ? "Fixed Income" : type === "cash" ? "Cash" : typeLabel[type] || type;
      return `<span><span class="dot" style="background:var(--${dotColorVar(type)})"></span>${label} ${pct}%</span>`;
    })
    .join("");
}

function dotColorVar(type) {
  switch (type) {
    case "equity": return "ic-navy";
    case "etf": return "ic-bright-2";
    case "reit": return "green";
    case "fixed": return "ink-soft";
    default: return "line";
  }
}

function allocBarHtml(fund) {
  const { buckets, sum } = fundAllocation(fund);
  const order = ["equity", "etf", "fixed", "reit", "cash"];
  return `<div class="alloc-bar">${order
    .map((type) => {
      const v = buckets[type] || 0;
      if (v <= 0) return "";
      const pct = (v / sum) * 100;
      return `<span class="${typeDot[type]}" style="width:${pct}%"></span>`;
    })
    .join("")}</div>`;
}

function renderFundGrid() {
  const grid = document.getElementById("fundGrid");
  const order = ["equity", "fixedIncome", "ctc"];
  grid.innerHTML = order
    .map((id) => {
      const fund = state.holdings.funds[id];
      const { total } = fundLiveValue(fund);
      const monthChange = total - fund.beginningValue;
      const dir = monthChange >= 0 ? "up" : "down";
      return `
        <div class="fund-card" data-view="${id}" role="button" tabindex="0" aria-label="View ${fund.name}">
          <span class="fund-badge">ICSB</span>
          <div>
            <h3 class="fund-name">${fund.name}</h3>
            <p class="fund-tagline">${fund.tagline}</p>
          </div>
          <div class="fund-value">${fmtUSD(total ?? fund.endingValue)}</div>
          <div class="fund-meta">
            <span class="${dir}">${dir === "up" ? "▲" : "▼"} ${fmtUSD(Math.abs(monthChange))} this month</span>
            <span>${fund.holdings.length} holdings</span>
          </div>
          ${allocBarHtml(fund)}
        </div>`;
    })
    .join("");

  grid.querySelectorAll(".fund-card").forEach((card) => {
    card.addEventListener("click", () => switchView(card.dataset.view));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); switchView(card.dataset.view); }
    });
  });
}

// ---------------------------------------------------------------
// Fund detail
// ---------------------------------------------------------------

function renderFundDetail(id) {
  const fund = state.holdings.funds[id];
  document.getElementById("fdName").textContent = fund.name;
  document.getElementById("fdTagline").textContent = fund.tagline;

  const { total } = fundLiveValue(fund);
  const monthChange = total - fund.beginningValue;
  const ytdChange = total - fund.ytdBeginningValue;

  document.getElementById("fdStatRow").innerHTML = `
    <div class="stat">
      <div class="label">FUND VALUE</div>
      <div class="value">${fmtUSD(total ?? fund.endingValue)}</div>
    </div>
    <div class="stat">
      <div class="label">MONTH CHANGE</div>
      <div class="value ${monthChange >= 0 ? "up" : "down"}">${monthChange >= 0 ? "+" : ""}${fmtUSD(monthChange)}</div>
    </div>
    <div class="stat">
      <div class="label">YTD CHANGE</div>
      <div class="value ${ytdChange >= 0 ? "up" : "down"}">${ytdChange >= 0 ? "+" : ""}${fmtUSD(ytdChange)}</div>
    </div>
    <div class="stat">
      <div class="label">UNREALIZED GAIN/LOSS</div>
      <div class="value ${fund.unrealizedGain >= 0 ? "up" : "down"}">${fmtUSD(fund.unrealizedGain)}</div>
    </div>
    <div class="stat">
      <div class="label">CASH &amp; EQUIVALENTS</div>
      <div class="value">${fmtUSD(fund.cash)}</div>
    </div>
  `;

  document.getElementById("fdAllocLegend").innerHTML = allocLegendHtml(fund);

  const { sum } = fundAllocation(fund);
  const rows = [...fund.holdings]
    .map((h) => {
      const q = state.quotes[h.symbol];
      const price = q?.price;
      const chg = q?.changePercent;
      const value = price != null ? price * h.qty : null;
      const dir = chg == null ? "flat" : chg > 0 ? "up" : chg < 0 ? "down" : "flat";
      return { h, price, chg, value, dir };
    })
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  document.getElementById("fdHoldingsBody").innerHTML = rows
    .map(({ h, price, chg, value, dir }) => `
      <tr>
        <td class="name-cell"><span class="sym">${h.symbol}</span>${h.name}</td>
        <td class="num">${h.qty.toLocaleString()}</td>
        <td class="num">${price != null ? fmtUSD(price) : "—"}</td>
        <td class="num chg ${dir}">${chg != null ? fmtPct(chg) : "—"}</td>
        <td class="num">${value != null ? fmtUSD(value) : "—"}</td>
        <td class="num">${value != null ? ((value / sum) * 100).toFixed(1) + "%" : "—"}</td>
      </tr>
    `)
    .join("");

  if (fund.treasuries?.length) {
    document.getElementById("fdHoldingsBody").innerHTML += fund.treasuries
      .map(
        (t) => `
      <tr>
        <td class="name-cell"><span class="sym">${t.cusip}</span>${t.description}</td>
        <td class="num">$${t.parValue.toLocaleString()} par</td>
        <td class="num">—</td>
        <td class="num chg flat">—</td>
        <td class="num">${fmtUSD(t.marketValue)}</td>
        <td class="num">${((t.marketValue / sum) * 100).toFixed(1)}%</td>
      </tr>`
      )
      .join("");
  }

  const note = document.getElementById("fdLiveNote");
  note.innerHTML = state.quotesSource
    ? `<span class="live-dot"></span>${state.quotesSource === "live" ? "Live prices" : "Cached prices"} · ${fmtLiveDate(state.quotesAsOf || Date.now())} · ${fmtLiveTime(state.quotesAsOf || Date.now())} · updates every 30 seconds during market hours.`
    : `<span class="live-dot"></span>Loading live prices…`;
}

// ---------------------------------------------------------------
// View routing
// ---------------------------------------------------------------

function switchView(view) {
  document.querySelectorAll("nav.tabs button").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
  });

  const overviewEl = document.getElementById("view-overview");
  const detailEl = document.getElementById("view-fund-detail");
  const galleryEl = document.getElementById("view-gallery");
  const performanceEl = document.getElementById("view-performance");

  overviewEl.classList.add("hidden");
  detailEl.classList.add("hidden");
  galleryEl.classList.add("hidden");
  performanceEl.classList.add("hidden");

  if (view === "overview") {
    overviewEl.classList.remove("hidden");
  } else if (view === "gallery") {
    galleryEl.classList.remove("hidden");
  } else if (view === "performance") {
    performanceEl.classList.remove("hidden");
  } else {
    detailEl.classList.remove("hidden");
    renderFundDetail(view);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.getElementById("mainTabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-view]");
  if (btn) switchView(btn.dataset.view);
});

document.querySelectorAll(".hero-actions [data-view]").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

// ---------------------------------------------------------------
// Boot
// ---------------------------------------------------------------

async function refreshAll() {
  await loadQuotes();
  renderTicker();
  renderOverview();
  const activeTab = document.querySelector("nav.tabs button.active");
  const fundIds = new Set(Object.keys(state.holdings.funds));
  if (activeTab && fundIds.has(activeTab.dataset.view)) {
    renderFundDetail(activeTab.dataset.view);
  }
}

(async function init() {
  await loadHoldings();
  renderTicker();
  renderOverview();
  await loadQuotes();
  renderTicker();
  renderOverview();

  setInterval(refreshAll, 30000);
})();
