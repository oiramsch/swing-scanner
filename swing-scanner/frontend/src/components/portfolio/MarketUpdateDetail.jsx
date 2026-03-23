const IMPACT_STYLES = {
  positive: "text-green-400",
  negative: "text-red-400",
  neutral: "text-gray-400",
};

const IMPACT_ICONS = {
  positive: "🟢",
  negative: "🔴",
  neutral: "🟡",
};

const ACTION_COLORS = {
  hold: "text-gray-400",
  tighten_stop: "text-yellow-400",
  take_partial: "text-blue-400",
  exit: "text-red-400",
  add: "text-green-400",
};

function parseJSON(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

export default function MarketUpdateDetail({ update }) {
  const positions = parseJSON(update?.positions_affected_json) || update?.positions_affected || [];
  const recommendations = parseJSON(update?.recommendations_json) || {};
  const sectorMovers = parseJSON(update?.sector_movers_json);

  const topSectors = sectorMovers?.top || [];
  const bottomSectors = sectorMovers?.bottom || [];

  const spyChange = update?.spy_change_pct;
  const qqq = update?.qqq_change_pct;
  const vix = update?.vix_level;
  const regime = update?.market_regime || "neutral";

  const regimeColor = { bull: "text-green-400", bear: "text-red-400", neutral: "text-yellow-400" }[regime] || "text-gray-400";
  const regimeIcon = { bull: "🟢", bear: "🔴", neutral: "🟡" }[regime] || "⚪";

  return (
    <div className="px-4 py-4 space-y-4 bg-gray-900/40">
      {/* Market context */}
      <div>
        <h4 className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-2">Markt-Kontext</h4>
        <div className="flex flex-wrap gap-3 text-xs">
          {spyChange !== null && spyChange !== undefined && (
            <div className="flex items-center gap-1">
              <span className="text-gray-500">S&P 500:</span>
              <span className={spyChange >= 0 ? "text-green-400 font-medium" : "text-red-400 font-medium"}>
                {spyChange >= 0 ? "+" : ""}{spyChange.toFixed(1)}%
              </span>
            </div>
          )}
          {qqq !== null && qqq !== undefined && (
            <div className="flex items-center gap-1">
              <span className="text-gray-500">NASDAQ:</span>
              <span className={qqq >= 0 ? "text-green-400 font-medium" : "text-red-400 font-medium"}>
                {qqq >= 0 ? "+" : ""}{qqq.toFixed(1)}%
              </span>
            </div>
          )}
          {vix && (
            <div className="flex items-center gap-1">
              <span className="text-gray-500">VIX:</span>
              <span className="text-white font-medium">{vix.toFixed(1)}</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <span className="text-gray-500">Regime:</span>
            <span className={`font-medium ${regimeColor}`}>{regimeIcon} {regime.toUpperCase()}</span>
          </div>
        </div>

        {/* Sector movers */}
        {(topSectors.length > 0 || bottomSectors.length > 0) && (
          <div className="mt-2 flex flex-wrap gap-4 text-xs">
            {topSectors.length > 0 && (
              <div>
                <span className="text-green-500 font-medium">▲ Stärkste: </span>
                <span className="text-gray-400">{topSectors.map(s => Array.isArray(s) ? `${s[0]} ${s[1] >= 0 ? "+" : ""}${s[1].toFixed(1)}%` : s).join(", ")}</span>
              </div>
            )}
            {bottomSectors.length > 0 && (
              <div>
                <span className="text-red-500 font-medium">▼ Schwächste: </span>
                <span className="text-gray-400">{bottomSectors.map(s => Array.isArray(s) ? `${s[0]} ${s[1] >= 0 ? "+" : ""}${s[1].toFixed(1)}%` : s).join(", ")}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Position impact */}
      {positions.length > 0 && (
        <div>
          <h4 className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-2">Positions-Übersicht</h4>
          <div className="space-y-2">
            {positions.map((p, i) => (
              <div key={i} className="flex items-start gap-3 bg-gray-800/40 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-semibold text-sm">[{p.ticker}]</span>
                    <span className={`text-xs ${IMPACT_STYLES[p.impact] || "text-gray-400"}`}>
                      {IMPACT_ICONS[p.impact] || "⚪"} {p.impact === "positive" ? "Positiv" : p.impact === "negative" ? "Negativ" : "Neutral"}
                    </span>
                    {p.impact_reason && (
                      <span className="text-gray-400 text-xs italic truncate">{p.impact_reason}</span>
                    )}
                  </div>
                  {p.action_detail && (
                    <p className={`text-xs mt-0.5 ${ACTION_COLORS[p.action] || "text-gray-400"}`}>
                      → {p.action?.toUpperCase()} | {p.action_detail}
                    </p>
                  )}
                  {p.stop_adjustment && (
                    <p className="text-yellow-400 text-xs mt-0.5">Stop anpassen: {p.stop_adjustment}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Overall recommendation */}
      {(recommendations.risk_summary || update?.portfolio_summary) && (
        <div className="bg-gray-800/40 rounded-lg px-3 py-3">
          <h4 className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-1.5">Gesamt-Empfehlung</h4>
          {update?.portfolio_summary && (
            <p className="text-gray-200 text-sm mb-1">{update.portfolio_summary}</p>
          )}
          {recommendations.risk_summary && recommendations.risk_summary !== update?.portfolio_summary && (
            <p className="text-gray-400 text-xs">{recommendations.risk_summary}</p>
          )}
        </div>
      )}

      {/* Tomorrow watchlist */}
      {recommendations.tomorrow_watchlist && (
        <div className="text-xs text-gray-500">
          <span className="text-gray-400 font-medium">Morgen beachten: </span>
          {recommendations.tomorrow_watchlist}
        </div>
      )}

      {/* Opportunities */}
      {recommendations.opportunities && recommendations.opportunities !== "null" && recommendations.opportunities !== null && (
        <div className="text-xs text-blue-400/80">
          <span className="font-medium">Opportunitäten: </span>
          {recommendations.opportunities}
        </div>
      )}
    </div>
  );
}
