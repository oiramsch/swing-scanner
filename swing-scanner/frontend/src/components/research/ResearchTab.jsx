import { useState, useRef, useEffect } from "react";
import axios from "axios";
import CandidateChart from "../chart/CandidateChart.jsx";
import ResearchPlanModal from "./ResearchPlanModal.jsx";
import WatchlistSidebar from "./WatchlistSidebar.jsx";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, Cell,
} from "recharts";

// ── Small shared UI pieces ──────────────────────────────────────────────────

function PctBadge({ value }) {
  if (value === null || value === undefined) return <span className="text-gray-600">—</span>;
  const pos = value >= 0;
  return (
    <span className={`font-semibold ${pos ? "text-green-400" : "text-red-400"}`}>
      {pos ? "+" : ""}{value.toFixed(1)}%
    </span>
  );
}

function MetricRow({ label, value }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-gray-800 last:border-0">
      <span className="text-gray-500 text-xs">{label}</span>
      <span className="text-white text-xs font-medium">{value ?? "—"}</span>
    </div>
  );
}

function SectionCard({ title, children }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{title}</div>
      {children}
    </div>
  );
}

// ── Seasonal tooltip ────────────────────────────────────────────────────────

function SeasonalTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs">
      <div className="font-semibold text-white mb-1">{d.label}</div>
      <div className={d.avg_return >= 0 ? "text-green-400" : "text-red-400"}>
        Ø {d.avg_return >= 0 ? "+" : ""}{d.avg_return.toFixed(2)}%
      </div>
      <div className="text-gray-500 mt-0.5">
        Positiv: {d.positive_years}/{d.total_years} Jahre
      </div>
    </div>
  );
}

// ── Tab: Übersicht ──────────────────────────────────────────────────────────

function TabUebersicht({ data, currentPrice, perf }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SectionCard title="Fundamentals">
          <MetricRow label="Market Cap"   value={data.market_cap} />
          <MetricRow label="KGV (trailing)" value={data.pe_ratio} />
          <MetricRow label="KGV (forward)"  value={data.forward_pe} />
          <MetricRow label="Beta"          value={data.beta} />
          <MetricRow label="Dividende"     value={data.dividend_yield ? `${data.dividend_yield}%` : null} />
          <MetricRow label="Short Float"   value={data.short_float ? `${data.short_float}%` : null} />
          {data.employees && (
            <MetricRow label="Mitarbeiter" value={data.employees.toLocaleString("de")} />
          )}
        </SectionCard>

        <SectionCard title="Technisch">
          <MetricRow label="52W Hoch" value={data.w52_high ? `$${data.w52_high.toFixed(2)}` : null} />
          <MetricRow label="52W Tief" value={data.w52_low  ? `$${data.w52_low.toFixed(2)}`  : null} />
          {data.w52_high && data.w52_low && currentPrice && (
            <div className="mt-2 mb-2">
              <div className="flex justify-between text-[10px] text-gray-600 mb-1">
                <span>${data.w52_low.toFixed(0)}</span>
                <span>${data.w52_high.toFixed(0)}</span>
              </div>
              <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full"
                  style={{ width: `${Math.min(100, Math.max(0, ((currentPrice - data.w52_low) / (data.w52_high - data.w52_low)) * 100))}%` }}
                />
              </div>
              <div className="text-center text-[10px] text-gray-500 mt-1">
                {(((currentPrice - data.w52_low) / (data.w52_high - data.w52_low)) * 100).toFixed(0)}% vom 52W-Tief
              </div>
            </div>
          )}
          <MetricRow label="Ø Volumen"  value={data.avg_volume ? `${(data.avg_volume / 1e6).toFixed(1)}M` : null} />
          {data.float_shares && (
            <MetricRow label="Float" value={`${(data.float_shares / 1e6).toFixed(1)}M`} />
          )}
        </SectionCard>
      </div>

      {/* Performance grid */}
      {currentPrice && (
        <SectionCard title="Performance">
          <div className="grid grid-cols-5 gap-0 text-center">
            {[
              { label: "1M",  value: perf.change_1m },
              { label: "3M",  value: perf.change_3m },
              { label: "6M",  value: perf.change_6m },
              { label: "YTD", value: perf.change_ytd },
              { label: "1J",  value: perf.change_1y },
            ].map(({ label, value }) => (
              <div key={label} className="flex flex-col items-center py-2 border-r border-gray-800 last:border-0">
                <div className="text-[10px] text-gray-600 mb-1">{label}</div>
                <PctBadge value={value} />
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Description */}
      {data.description && (
        <SectionCard title="Unternehmen">
          <p className="text-xs text-gray-400 leading-relaxed">{data.description}</p>
          {(data.country || data.exchange) && (
            <div className="mt-2 text-[11px] text-gray-600">{data.country} · {data.exchange}</div>
          )}
        </SectionCard>
      )}
    </div>
  );
}

// ── Tab: Saisonal ───────────────────────────────────────────────────────────

function TabSeasonal({ ticker }) {
  const [seasonal, setSeasonal] = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    axios.get(`/api/research/${ticker}/seasonal`)
      .then(res => { setSeasonal(res.data); setLoading(false); })
      .catch(err => { setError(err.response?.data?.detail || "Fehler beim Laden"); setLoading(false); });
  }, [ticker]);

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-gray-600 text-sm animate-pulse">
      Saisonalität wird geladen…
    </div>
  );
  if (error) return (
    <div className="px-4 py-3 rounded-lg bg-red-900/20 border border-red-700/40 text-red-400 text-sm">{error}</div>
  );
  if (!seasonal) return null;

  const { monthly_returns, best_month, worst_month, data_years } = seasonal;

  return (
    <div className="space-y-4">
      <SectionCard title={`Saisonalität — Ø Monatsrendite (${data_years} Jahre)`}>
        <div className="flex gap-4 mb-4">
          <div className="text-xs">
            <span className="text-gray-500">Stärkster Monat: </span>
            <span className="text-green-400 font-semibold">{best_month.label}</span>
          </div>
          <div className="text-xs">
            <span className="text-gray-500">Schwächster Monat: </span>
            <span className="text-red-400 font-semibold">{worst_month.label}</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={monthly_returns} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <XAxis
              dataKey="label"
              tick={{ fill: "#6b7280", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={v => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`}
              tick={{ fill: "#6b7280", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<SeasonalTooltip />} cursor={{ fill: "#1e293b" }} />
            <ReferenceLine y={0} stroke="#374151" strokeWidth={1} />
            <Bar dataKey="avg_return" radius={[3, 3, 0, 0]}>
              {monthly_returns.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.avg_return >= 0 ? "#22c55e" : "#ef4444"}
                  opacity={entry.month === best_month.month || entry.month === worst_month.month ? 1 : 0.7}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>

      {/* Win-rate table */}
      <SectionCard title="Positive Jahre je Monat">
        <div className="grid grid-cols-6 gap-1">
          {monthly_returns.map(m => {
            const pct = m.total_years > 0 ? (m.positive_years / m.total_years) * 100 : 0;
            return (
              <div key={m.month} className="flex flex-col items-center gap-1 py-1">
                <span className="text-[10px] text-gray-600">{m.label}</span>
                <span className={`text-xs font-semibold ${pct >= 60 ? "text-green-400" : pct >= 40 ? "text-yellow-400" : "text-red-400"}`}>
                  {pct.toFixed(0)}%
                </span>
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}

// ── Tab: News ───────────────────────────────────────────────────────────────

function TabNews({ news }) {
  if (!news?.length) return (
    <div className="text-gray-600 text-sm text-center py-8">Keine aktuellen News verfügbar.</div>
  );
  return (
    <SectionCard title="Aktuelle News">
      <div className="space-y-0">
        {news.map((n, i) => (
          <a key={i} href={n.link} target="_blank" rel="noopener noreferrer" className="block group">
            <div className="flex items-start gap-2 py-2.5 border-b border-gray-800 last:border-0">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-gray-200 group-hover:text-white transition line-clamp-2 leading-snug">
                  {n.title}
                </div>
                <div className="text-[10px] text-gray-600 mt-0.5">
                  {n.publisher}
                  {n.published_ts && (
                    <span className="ml-1">· {new Date(n.published_ts * 1000).toLocaleDateString("de", { day: "2-digit", month: "short" })}</span>
                  )}
                </div>
              </div>
              <span className="text-gray-700 group-hover:text-gray-500 text-xs flex-shrink-0 mt-0.5">↗</span>
            </div>
          </a>
        ))}
      </div>
    </SectionCard>
  );
}

// ── Tab: KI-Beratung ────────────────────────────────────────────────────────

function TabAI({ data, currentPrice }) {
  const [reply,    setReply]    = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const lastTicker = useRef(null);

  async function analyse() {
    setLoading(true);
    setError(null);
    setReply(null);
    const perf = data.performance ?? {};

    const prompt = `Analysiere ${data.ticker} (${data.name || data.ticker}) als Swing-Trading-Kandidat.

Aktuelle Daten:
- Kurs: $${currentPrice?.toFixed(2) ?? "unbekannt"}
- Sektor: ${data.sector || "—"}
- Marktkapitalisierung: ${data.market_cap || "—"}
- Beta: ${data.beta ?? "—"}
- KGV: ${data.pe_ratio ?? "—"} (forward: ${data.forward_pe ?? "—"})
- Short Float: ${data.short_float ? data.short_float + "%" : "—"}
- 52W Hoch/Tief: $${data.w52_high?.toFixed(2) ?? "—"} / $${data.w52_low?.toFixed(2) ?? "—"}
- Performance: 1M ${perf.change_1m?.toFixed(1) ?? "—"}%, 3M ${perf.change_3m?.toFixed(1) ?? "—"}%, 6M ${perf.change_6m?.toFixed(1) ?? "—"}%, YTD ${perf.change_ytd?.toFixed(1) ?? "—"}%
${data.next_earnings ? `- Nächste Earnings: ${data.next_earnings} (in ${data.earnings_in_days} Tagen)` : ""}

Bitte beantworte:
1. Wie attraktiv ist der Wert aktuell für Swing-Trader (technisch + fundamental)?
2. Was sind die wichtigsten Chancen und Risiken?
3. Auf welche Levels/Katalysatoren sollte man achten?

Bitte in 3–5 kurzen Absätzen. Keine Anlageberatung.`;

    try {
      const res = await axios.post("/api/chat", { message: prompt, session_history: [] });
      setReply(res.data.reply);
    } catch (err) {
      setError(err.response?.data?.detail || "Claude API nicht erreichbar.");
    } finally {
      setLoading(false);
    }
  }

  // Auto-analyse when switching to this tab (once per ticker)
  useEffect(() => {
    if (lastTicker.current !== data.ticker) {
      lastTicker.current = data.ticker;
      analyse();
    }
  }, [data.ticker]);

  return (
    <div className="space-y-3">
      {/* Disclaimer */}
      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-900/10 border border-amber-700/30 text-[11px] text-amber-400/80">
        <span className="mt-0.5">⚠️</span>
        <span>Diese KI-Analyse dient ausschließlich als Informationsquelle — keine Anlage- oder Handelsberatung. Alle Entscheidungen auf eigenes Risiko.</span>
      </div>

      {loading && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-2 animate-pulse">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-3 bg-gray-800 rounded" style={{ width: `${85 + i * 3}%` }} />
          ))}
        </div>
      )}

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-900/20 border border-red-700/40 text-red-400 text-sm">{error}</div>
      )}

      {reply && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-5 h-5 rounded-full bg-indigo-700 flex items-center justify-center text-[10px] text-white font-bold">C</div>
            <span className="text-xs text-gray-400">Claude · {data.ticker} Swing-Analyse</span>
          </div>
          <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{reply}</div>
        </div>
      )}

      {(reply || error) && !loading && (
        <button
          onClick={analyse}
          className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-white transition"
        >
          Neu analysieren
        </button>
      )}
    </div>
  );
}

// ── Main ResearchTab ────────────────────────────────────────────────────────

const TABS = ["Übersicht", "Saisonal", "News", "KI-Beratung"];

export default function ResearchTab() {
  const [query,    setQuery]    = useState("");
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [showPlan, setShowPlan] = useState(false);
  const [draftPlan, setDraftPlan] = useState(null);
  const [activeTab, setActiveTab] = useState("Übersicht");

  async function search(ticker) {
    const sym = (ticker || query).trim().toUpperCase();
    if (!sym) return;
    setLoading(true);
    setError(null);
    setData(null);
    setDraftPlan(null);
    setActiveTab("Übersicht");
    try {
      const res = await axios.get(`/api/research/${sym}`);
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || `Keine Daten für ${sym}`);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e) {
    if (e.key === "Enter") search();
  }

  const perf = data?.performance ?? {};
  const earningsWarning = data?.earnings_in_days !== null && data?.earnings_in_days <= 7;
  const currentPrice = perf.current ?? null;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex gap-4 items-start">

        {/* ── Main content ─────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* Search bar */}
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value.toUpperCase())}
              onKeyDown={handleKey}
              placeholder="Ticker eingeben… z.B. AAPL, MSFT, NVDA"
              className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={() => search()}
              disabled={loading || !query.trim()}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 text-white text-sm font-semibold rounded-lg transition"
            >
              {loading ? "Lädt…" : "Suchen"}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="px-4 py-3 rounded-lg bg-red-900/20 border border-red-700/40 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Loading skeleton */}
          {loading && (
            <div className="space-y-4 animate-pulse">
              <div className="h-[460px] bg-gray-900 border border-gray-800 rounded-xl" />
              <div className="h-10 bg-gray-900 border border-gray-800 rounded-xl" />
              <div className="h-40 bg-gray-900 border border-gray-800 rounded-xl" />
            </div>
          )}

          {/* Results */}
          {data && !loading && (
            <div className="space-y-4">

              {/* ── Chart card ─────────────────────────────────────────── */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                {/* Chart header */}
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-bold">{data.ticker}</span>
                    {data.name && <span className="text-gray-500 text-sm">{data.name}</span>}
                    {data.sector && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-900/40 border border-indigo-700/40 text-indigo-300">
                        {data.sector}
                      </span>
                    )}
                    {currentPrice && (
                      <span className="text-white font-semibold">${currentPrice.toFixed(2)}</span>
                    )}
                    {perf.change_1m !== undefined && (
                      <span className="text-xs text-gray-500">1M <PctBadge value={perf.change_1m} /></span>
                    )}
                  </div>
                  <button
                    onClick={() => setShowPlan(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-indigo-700 hover:bg-indigo-600 text-white rounded-lg border border-indigo-600/60 transition"
                  >
                    + Tradingplan erstellen
                  </button>
                </div>
                <CandidateChart symbol={data.ticker} draftPlan={draftPlan} />
              </div>

              {/* ── Earnings warnings ──────────────────────────────────── */}
              {earningsWarning && (
                <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-orange-900/20 border border-orange-700/50 text-orange-300 text-sm">
                  <span className="text-lg leading-none mt-0.5">⚠️</span>
                  <div>
                    <span className="font-semibold">
                      Earnings in {data.earnings_in_days === 0 ? "heute" : `${data.earnings_in_days} Tag${data.earnings_in_days === 1 ? "" : "en"}`}
                    </span>
                    {data.next_earnings && (
                      <span className="text-orange-400/70 ml-2 text-xs">({data.next_earnings})</span>
                    )}
                    <div className="text-orange-400/60 text-xs mt-0.5">
                      Erhöhtes Gap-Risiko — Positionsgröße anpassen oder abwarten.
                    </div>
                  </div>
                </div>
              )}
              {!earningsWarning && data.next_earnings && (
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-900 border border-gray-800 text-xs text-gray-400">
                  <span>📅</span>
                  <span>Nächste Earnings: <span className="text-white font-medium">{data.next_earnings}</span>
                    <span className="text-gray-600 ml-1">({data.earnings_in_days} Tage)</span>
                  </span>
                </div>
              )}

              {/* ── Info Tabs ──────────────────────────────────────────── */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                {/* Tab bar */}
                <div className="flex border-b border-gray-800">
                  {TABS.map(tab => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-4 py-2.5 text-xs font-medium transition border-b-2 -mb-px ${
                        activeTab === tab
                          ? "text-indigo-300 border-indigo-500"
                          : "text-gray-500 border-transparent hover:text-gray-300"
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
                {/* Tab content */}
                <div className="p-4">
                  {activeTab === "Übersicht"   && <TabUebersicht data={data} currentPrice={currentPrice} perf={perf} />}
                  {activeTab === "Saisonal"    && <TabSeasonal ticker={data.ticker} />}
                  {activeTab === "News"        && <TabNews news={data.news} />}
                  {activeTab === "KI-Beratung" && <TabAI data={data} currentPrice={currentPrice} />}
                </div>
              </div>

            </div>
          )}
        </div>

        {/* ── Watchlist Sidebar ──────────────────────────────────────────── */}
        <WatchlistSidebar
          activeTicker={data?.ticker ?? null}
          onSelect={ticker => { setQuery(ticker); search(ticker); }}
        />
      </div>

      {/* ── Trading Plan Modal ─────────────────────────────────────────────── */}
      {showPlan && data && (
        <ResearchPlanModal
          ticker={data.ticker}
          currentPrice={currentPrice}
          onClose={() => { setShowPlan(false); setDraftPlan(null); }}
          onSaved={() => { setShowPlan(false); setDraftPlan(null); }}
          onDraftChange={setDraftPlan}
        />
      )}
    </div>
  );
}
