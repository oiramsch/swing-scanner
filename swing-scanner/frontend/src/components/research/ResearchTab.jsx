import { useState } from "react";
import axios from "axios";

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

export default function ResearchTab() {
  const [query, setQuery] = useState("");
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function search(ticker) {
    const sym = (ticker || query).trim().toUpperCase();
    if (!sym) return;
    setLoading(true);
    setError(null);
    setData(null);
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

  return (
    <div className="max-w-3xl mx-auto space-y-5">

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
          {[1, 2, 3].map(i => (
            <div key={i} className="h-28 bg-gray-900 border border-gray-800 rounded-xl" />
          ))}
        </div>
      )}

      {/* Results */}
      {data && !loading && (
        <div className="space-y-4">

          {/* Company header */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white text-xl font-bold">{data.ticker}</span>
                  {data.name && <span className="text-gray-400 text-sm">{data.name}</span>}
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {data.sector && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-900/40 border border-indigo-700/40 text-indigo-300">
                      {data.sector}
                    </span>
                  )}
                  {data.industry && (
                    <span className="text-[11px] text-gray-500">{data.industry}</span>
                  )}
                  {data.country && (
                    <span className="text-[11px] text-gray-600">{data.country} · {data.exchange}</span>
                  )}
                </div>
              </div>
              <div className="text-right">
                {perf.current && (
                  <div className="text-white text-xl font-bold">${perf.current.toFixed(2)}</div>
                )}
                {perf.change_1m !== undefined && (
                  <div className="text-xs text-gray-500 mt-0.5">1M <PctBadge value={perf.change_1m} /></div>
                )}
              </div>
            </div>

            {/* Description */}
            {data.description && (
              <p className="mt-3 text-xs text-gray-500 leading-relaxed line-clamp-3">
                {data.description}
              </p>
            )}
          </div>

          {/* Earnings warning */}
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
                  Erhöhtes Gap-Risiko vor dem Event — Positionsgröße anpassen oder abwarten.
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

          {/* Metrics grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SectionCard title="Fundamentals">
              <MetricRow label="Market Cap" value={data.market_cap} />
              <MetricRow label="KGV (trailing)" value={data.pe_ratio} />
              <MetricRow label="KGV (forward)" value={data.forward_pe} />
              <MetricRow label="Beta" value={data.beta} />
              <MetricRow label="Dividende" value={data.dividend_yield ? `${data.dividend_yield}%` : null} />
              <MetricRow label="Short Float" value={data.short_float ? `${data.short_float}%` : null} />
              {data.employees && (
                <MetricRow label="Mitarbeiter" value={data.employees.toLocaleString("de")} />
              )}
            </SectionCard>

            <SectionCard title="Technisch">
              <MetricRow label="52W Hoch" value={data.w52_high ? `$${data.w52_high.toFixed(2)}` : null} />
              <MetricRow label="52W Tief" value={data.w52_low ? `$${data.w52_low.toFixed(2)}` : null} />
              {data.w52_high && data.w52_low && perf.current && (
                <div className="mt-2">
                  <div className="flex justify-between text-[10px] text-gray-600 mb-1">
                    <span>${data.w52_low.toFixed(0)}</span>
                    <span>${data.w52_high.toFixed(0)}</span>
                  </div>
                  <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full"
                      style={{
                        width: `${Math.min(100, Math.max(0,
                          ((perf.current - data.w52_low) / (data.w52_high - data.w52_low)) * 100
                        ))}%`
                      }}
                    />
                  </div>
                  <div className="text-center text-[10px] text-gray-500 mt-1">
                    {(((perf.current - data.w52_low) / (data.w52_high - data.w52_low)) * 100).toFixed(0)}% vom 52W-Tief
                  </div>
                </div>
              )}
              <MetricRow
                label="Ø Volumen"
                value={data.avg_volume ? `${(data.avg_volume / 1e6).toFixed(1)}M` : null}
              />
              {data.float_shares && (
                <MetricRow label="Float" value={`${(data.float_shares / 1e6).toFixed(1)}M`} />
              )}
            </SectionCard>
          </div>

          {/* Performance */}
          {perf.current && (
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

          {/* News */}
          {data.news?.length > 0 && (
            <SectionCard title="Aktuelle News">
              <div className="space-y-2">
                {data.news.map((n, i) => (
                  <a
                    key={i}
                    href={n.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block group"
                  >
                    <div className="flex items-start gap-2 py-2 border-b border-gray-800 last:border-0">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-gray-200 group-hover:text-white transition line-clamp-2 leading-snug">
                          {n.title}
                        </div>
                        <div className="text-[10px] text-gray-600 mt-0.5">
                          {n.publisher}
                          {n.published_ts && (
                            <span className="ml-1">
                              · {new Date(n.published_ts * 1000).toLocaleDateString("de", { day: "2-digit", month: "short" })}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-gray-700 group-hover:text-gray-500 text-xs flex-shrink-0 mt-0.5">↗</span>
                    </div>
                  </a>
                ))}
              </div>
            </SectionCard>
          )}

          {/* BigData.com placeholder */}
          <div className="border border-dashed border-gray-800 rounded-xl px-4 py-5 text-center space-y-1">
            <div className="text-gray-600 text-xs font-semibold uppercase tracking-wider">
              Bigdata.com Integration — Phase 2
            </div>
            <div className="text-gray-700 text-xs">
              Earnings Transcripts · Analyst Reports · Sentiment · Company Tearsheet
            </div>
            <a href="https://bigdata.com" target="_blank" rel="noopener noreferrer"
              className="inline-block mt-1 text-[11px] text-indigo-600 hover:text-indigo-400 transition">
              bigdata.com ↗
            </a>
          </div>

        </div>
      )}
    </div>
  );
}
