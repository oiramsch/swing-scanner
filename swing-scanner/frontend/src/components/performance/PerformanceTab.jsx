import { useState, useEffect } from "react";
import axios from "axios";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from "recharts";

const CHART_STYLE = {
  background: "transparent",
  cartesianGrid: "#1f2937",
  axis: "#6b7280",
  tooltip: { bg: "#1f2937", border: "#374151", text: "#f9fafb" },
};

const FLAG_LABELS = {
  gap_up: "Gap Up",
  gap_down: "Gap Down",
  post_earnings: "Post-Earnings",
  pre_earnings: "Pre-Earnings",
  corporate_action: "Corp. Action",
  low_crv: "Low CRV",
  technicals_invalid: "Technicals Invalid",
  no_flags: "Keine Flags",
};

export default function PerformanceTab() {
  const [summary, setSummary] = useState(null);
  const [bySetup, setBySetup] = useState([]);
  const [equityCurve, setEquityCurve] = useState([]);
  const [stats, setStats] = useState(null);
  const [byFlags, setByFlags] = useState([]);
  const [crvValidation, setCrvValidation] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    try {
      const [sumRes, setupRes, eqRes, statsRes, flagsRes, crvRes] = await Promise.all([
        axios.get("/api/performance/summary"),
        axios.get("/api/performance/by-setup"),
        axios.get("/api/performance/equity-curve"),
        axios.get("/api/journal/stats"),
        axios.get("/api/performance/flags").catch(() => ({ data: [] })),
        axios.get("/api/performance/crv-validation").catch(() => ({ data: null })),
      ]);
      setSummary(sumRes.data);
      setBySetup(setupRes.data);
      setEquityCurve(eqRes.data);
      setStats(statsRes.data);
      setByFlags(flagsRes.data);
      setCrvValidation(crvRes.data);
    } finally { setLoading(false); }
  }

  if (loading) return (
    <div className="max-w-7xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => <div key={i} className="bg-gray-900 h-24 rounded-xl animate-pulse" />)}
    </div>
  );

  // Emotion chart data
  const emotionData = Object.entries(stats?.win_rate_by_emotion || {}).map(([em, rate]) => ({
    emotion: em,
    win_rate: rate,
    avg_pnl: stats?.avg_pnl_by_emotion?.[em] || 0,
  }));

  const rulesData = [
    { label: "Rules Followed", win_rate: stats?.win_rate_rules_followed || 0 },
    { label: "Rules Broken", win_rate: stats?.win_rate_rules_broken || 0 },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <h2 className="text-white font-semibold">Performance</h2>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-gray-900 rounded-xl p-4">
          <div className="text-gray-400 text-xs">Win Rate (Scanner)</div>
          <div className="text-white font-bold text-2xl">{summary?.win_rate || 0}%</div>
          <div className="text-gray-500 text-xs">{summary?.total_closed || 0} closed</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4">
          <div className="text-gray-400 text-xs">Win Rate (Journal)</div>
          <div className="text-green-400 font-bold text-2xl">{stats?.win_rate_overall || 0}%</div>
          <div className="text-gray-500 text-xs">{stats?.total_trades || 0} trades</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4">
          <div className="text-gray-400 text-xs">Rules → Win Rate</div>
          <div className="text-blue-400 font-bold text-2xl">{stats?.win_rate_rules_followed || 0}%</div>
          <div className="text-gray-500 text-xs">{stats?.trades_with_rules_followed || 0} trades</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4">
          <div className="text-gray-400 text-xs">FOMO → Win Rate</div>
          <div className="text-red-400 font-bold text-2xl">{stats?.win_rate_by_emotion?.fomo || 0}%</div>
          <div className="text-gray-500 text-xs">vs rules: {stats?.win_rate_rules_followed || 0}%</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Win rate by setup */}
        {bySetup.length > 0 && (
          <div className="bg-gray-900 rounded-xl p-4">
            <div className="text-gray-300 text-sm font-medium mb-4">Win Rate by Setup</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={bySetup} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_STYLE.cartesianGrid} />
                <XAxis dataKey="setup_type" tick={{ fill: CHART_STYLE.axis, fontSize: 11 }} />
                <YAxis tick={{ fill: CHART_STYLE.axis, fontSize: 11 }} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{ background: CHART_STYLE.tooltip.bg, border: `1px solid ${CHART_STYLE.tooltip.border}`, borderRadius: 8 }}
                  labelStyle={{ color: CHART_STYLE.tooltip.text }}
                />
                <Bar dataKey="win_rate" name="Win Rate %" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Emotion vs Win Rate */}
        {emotionData.length > 0 && (
          <div className="bg-gray-900 rounded-xl p-4">
            <div className="text-gray-300 text-sm font-medium mb-4">Emotion at Entry → Win Rate</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={emotionData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_STYLE.cartesianGrid} />
                <XAxis dataKey="emotion" tick={{ fill: CHART_STYLE.axis, fontSize: 11 }} />
                <YAxis tick={{ fill: CHART_STYLE.axis, fontSize: 11 }} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{ background: CHART_STYLE.tooltip.bg, border: `1px solid ${CHART_STYLE.tooltip.border}`, borderRadius: 8 }}
                  labelStyle={{ color: CHART_STYLE.tooltip.text }}
                />
                <Bar dataKey="win_rate" name="Win Rate %" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Rules followed comparison */}
        <div className="bg-gray-900 rounded-xl p-4">
          <div className="text-gray-300 text-sm font-medium mb-4">Rules Followed vs Broken</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={rulesData} layout="vertical" margin={{ top: 5, right: 10, left: 40, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_STYLE.cartesianGrid} />
              <XAxis type="number" domain={[0, 100]} tick={{ fill: CHART_STYLE.axis, fontSize: 11 }} />
              <YAxis type="category" dataKey="label" tick={{ fill: CHART_STYLE.axis, fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: CHART_STYLE.tooltip.bg, border: `1px solid ${CHART_STYLE.tooltip.border}`, borderRadius: 8 }}
              />
              <Bar dataKey="win_rate" name="Win Rate %" radius={[0, 4, 4, 0]}
                fill="#22c55e" />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-2 flex gap-4 text-xs">
            <span className="text-green-400 font-medium">Rules: €{stats?.avg_pnl_rules_followed?.toFixed(2) || 0} avg</span>
            <span className="text-red-400 font-medium">No rules: €{stats?.avg_pnl_rules_broken?.toFixed(2) || 0} avg</span>
          </div>
        </div>

        {/* Equity curve */}
        {equityCurve.length > 1 && (
          <div className="bg-gray-900 rounded-xl p-4">
            <div className="text-gray-300 text-sm font-medium mb-4">Equity Curve (Cumulative P&L)</div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={equityCurve} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_STYLE.cartesianGrid} />
                <XAxis dataKey="date" tick={{ fill: CHART_STYLE.axis, fontSize: 10 }}
                  tickFormatter={v => v.slice(5)} />
                <YAxis tick={{ fill: CHART_STYLE.axis, fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: CHART_STYLE.tooltip.bg, border: `1px solid ${CHART_STYLE.tooltip.border}`, borderRadius: 8 }}
                  formatter={(v) => [`€${v.toFixed(2)}`, "Cumulative P&L"]}
                />
                <Line type="monotone" dataKey="cumulative" stroke="#6366f1" strokeWidth={2}
                  dot={false} name="Cumulative P&L" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Setup breakdown table */}
      {bySetup.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="p-3 text-gray-300 text-sm font-medium border-b border-gray-800">Setup Breakdown</div>
          <table className="w-full text-sm">
            <thead className="text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Setup</th>
                <th className="px-4 py-2 text-right">Wins</th>
                <th className="px-4 py-2 text-right">Losses</th>
                <th className="px-4 py-2 text-right">Win Rate</th>
                <th className="px-4 py-2 text-right">Avg P&L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {bySetup.map(row => (
                <tr key={row.setup_type} className="hover:bg-gray-800/50">
                  <td className="px-4 py-2 text-white capitalize">{row.setup_type}</td>
                  <td className="px-4 py-2 text-right text-green-400">{row.wins}</td>
                  <td className="px-4 py-2 text-right text-red-400">{row.losses}</td>
                  <td className="px-4 py-2 text-right text-white font-medium">{row.win_rate}%</td>
                  <td className={`px-4 py-2 text-right font-medium ${row.avg_pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                    €{row.avg_pnl.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── News Flags Section ───────────────────────────────────────── */}
      <h3 className="text-gray-300 font-semibold text-sm mt-2">News &amp; Event-Filter Analyse</h3>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Win rate by flag */}
        {byFlags.length > 0 && (
          <div className="bg-gray-900 rounded-xl p-4">
            <div className="text-gray-300 text-sm font-medium mb-4">Win Rate mit / ohne Flags</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={byFlags.map(f => ({ ...f, name: FLAG_LABELS[f.flag] || f.flag }))}
                margin={{ top: 5, right: 10, left: -20, bottom: 30 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_STYLE.cartesianGrid} />
                <XAxis dataKey="name" tick={{ fill: CHART_STYLE.axis, fontSize: 10 }}
                  angle={-25} textAnchor="end" />
                <YAxis tick={{ fill: CHART_STYLE.axis, fontSize: 11 }} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{ background: CHART_STYLE.tooltip.bg, border: `1px solid ${CHART_STYLE.tooltip.border}`, borderRadius: 8 }}
                  formatter={(v, n, props) => [`${v}% (${props.payload.total} trades)`, "Win Rate"]}
                />
                <Bar dataKey="win_rate" name="Win Rate %" fill="#f97316" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* CRV Validation */}
        {crvValidation && (
          <div className="bg-gray-900 rounded-xl p-4">
            <div className="text-gray-300 text-sm font-medium mb-3">CRV-Validierung</div>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-green-900/20 border border-green-800/30 rounded-lg">
                <div>
                  <div className="text-xs text-gray-400">CRV ≥ 1.5 (valid)</div>
                  <div className="text-green-400 font-bold text-xl">{crvValidation.crv_valid_win_rate}%</div>
                  <div className="text-gray-500 text-xs">{crvValidation.crv_valid_total} Kandidaten</div>
                </div>
                <span className="text-2xl">✅</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-red-900/20 border border-red-800/30 rounded-lg">
                <div>
                  <div className="text-xs text-gray-400">CRV &lt; 1.5 (invalid)</div>
                  <div className="text-red-400 font-bold text-xl">{crvValidation.crv_invalid_win_rate}%</div>
                  <div className="text-gray-500 text-xs">{crvValidation.crv_invalid_total} Kandidaten</div>
                </div>
                <span className="text-2xl">⛔</span>
              </div>
              {crvValidation.filter_useful !== null && (
                <p className="text-xs text-center mt-1">
                  {crvValidation.filter_useful
                    ? <span className="text-green-400">✅ CRV-Filter ist sinnvoll — höhere Win Rate bei validen Setups</span>
                    : <span className="text-yellow-400">⚠️ CRV-Filter noch nicht aussagekräftig — mehr Daten nötig</span>
                  }
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Flags correlation table */}
      {byFlags.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="p-3 text-gray-300 text-sm font-medium border-b border-gray-800">
            Flag Korrelation — welche Warnungen korrelieren mit Verlusten?
          </div>
          <table className="w-full text-sm">
            <thead className="text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Flag</th>
                <th className="px-4 py-2 text-right">Trades</th>
                <th className="px-4 py-2 text-right">Wins</th>
                <th className="px-4 py-2 text-right">Losses</th>
                <th className="px-4 py-2 text-right">Win Rate</th>
                <th className="px-4 py-2 text-left">Bewertung</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {byFlags.map(row => {
                const noFlagsWr = byFlags.find(f => f.flag === "no_flags")?.win_rate || 50;
                const delta = row.win_rate - noFlagsWr;
                return (
                  <tr key={row.flag} className="hover:bg-gray-800/50">
                    <td className="px-4 py-2 text-white">{FLAG_LABELS[row.flag] || row.flag}</td>
                    <td className="px-4 py-2 text-right text-gray-300">{row.total}</td>
                    <td className="px-4 py-2 text-right text-green-400">{row.wins}</td>
                    <td className="px-4 py-2 text-right text-red-400">{row.losses}</td>
                    <td className={`px-4 py-2 text-right font-medium ${row.win_rate >= 50 ? "text-green-400" : "text-red-400"}`}>
                      {row.win_rate}%
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {row.flag === "no_flags"
                        ? <span className="text-gray-400">Baseline</span>
                        : delta <= -10
                        ? <span className="text-red-400">⚠️ Meiden ({delta.toFixed(0)}%)</span>
                        : delta >= 5
                        ? <span className="text-green-400">✅ Positiv (+{delta.toFixed(0)}%)</span>
                        : <span className="text-gray-500">Neutral</span>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
