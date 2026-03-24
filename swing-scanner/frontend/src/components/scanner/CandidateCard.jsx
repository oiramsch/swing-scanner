import { useState } from "react";
import axios from "axios";
import DeepAnalysisModal from "./DeepAnalysisModal.jsx";
import AddPositionModal from "../portfolio/AddPositionModal.jsx";

const SETUP_COLORS = {
  breakout: "bg-green-500/20 text-green-400 border-green-500/30",
  pullback: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  pattern: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  momentum: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  none: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

// Flag badge config: label, color classes
const FLAG_CONFIG = {
  gap_up:           { label: (c) => `GAP UP +${c.gap_pct?.toFixed(1)}%`, color: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" },
  gap_down:         { label: (c) => `GAP DOWN ${c.gap_pct?.toFixed(1)}%`, color: "bg-orange-500/20 text-orange-300 border-orange-500/30" },
  post_earnings:    { label: () => "POST-EARNINGS",        color: "bg-orange-500/20 text-orange-300 border-orange-500/30" },
  pre_earnings:     { label: () => "EARNINGS BALD",        color: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" },
  corporate_action: { label: () => "CORPORATE ACTION",     color: "bg-red-500/20 text-red-300 border-red-500/30" },
  low_crv:          { label: (c) => `CRV: ${c.crv_calculated?.toFixed(1)} ⛔`, color: "bg-orange-500/20 text-orange-300 border-orange-500/30" },
  technicals_invalid: { label: () => "CHARTTECHNIK UNGÜLTIG", color: "bg-red-500/20 text-red-300 border-red-500/30" },
};

function ConfidenceBar({ value }) {
  const pct = (value / 10) * 100;
  const color = value >= 8 ? "bg-green-500" : value >= 6 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-400 w-4 text-right">{value}</span>
    </div>
  );
}

function CRVBadge({ crv, crvValid }) {
  if (!crv) return null;
  const color = crvValid === false
    ? "text-red-400"
    : crv >= 2.0
    ? "text-green-400"
    : crv >= 1.5
    ? "text-yellow-400"
    : "text-red-400";
  const icon = crvValid === false ? "⛔" : crv >= 2.0 ? "✅" : crv >= 1.5 ? "⚠️" : "⛔";
  return (
    <span className={`text-xs font-medium ${color}`}>
      CRV: {crv.toFixed(1)} {icon}
    </span>
  );
}

// Parse first number from entry_zone string like "150.00-152.00" or "150.00"
function parseEntryPrice(entryZone) {
  if (!entryZone) return "";
  const match = String(entryZone).match(/[\d.]+/);
  return match ? match[0] : "";
}

function parseFlags(flagsJson) {
  if (!flagsJson) return [];
  try {
    return typeof flagsJson === "string" ? JSON.parse(flagsJson) : flagsJson;
  } catch { return []; }
}

function parseHeadlines(headlinesJson) {
  if (!headlinesJson) return [];
  try {
    return typeof headlinesJson === "string" ? JSON.parse(headlinesJson) : headlinesJson;
  } catch { return []; }
}

export default function CandidateCard({ candidate: c, budget = null }) {
  const [showDeep, setShowDeep] = useState(false);
  const [showPortfolio, setShowPortfolio] = useState(false);
  const [showHeadlines, setShowHeadlines] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [addedToWatchlist, setAddedToWatchlist] = useState(false);

  const colorClass = SETUP_COLORS[c.setup_type] || SETUP_COLORS.none;
  const chartFile = c.chart_path ? c.chart_path.split("/").pop() : null;
  const flags = parseFlags(c.flags);
  const headlines = parseHeadlines(c.news_headlines);

  const hasWarnings = flags.length > 0;
  const isInvalidated = flags.includes("technicals_invalid");

  // Pre-fill data for AddPositionModal
  const portfolioPrefill = {
    ticker: c.ticker,
    entry_price: parseEntryPrice(c.entry_zone),
    stop_loss: c.stop_loss ? String(c.stop_loss) : "",
    target: c.target ? String(c.target) : "",
    setup_type: c.setup_type || "breakout",
    sector: c.sector || "",
  };

  async function addToWatchlist() {
    try {
      await axios.post("/api/watchlist", {
        ticker: c.ticker,
        reason: `Scanner candidate: ${c.setup_type} (confidence ${c.confidence})`,
        scan_result_id: c.id,
      });
      setAddedToWatchlist(true);
    } catch {}
  }

  return (
    <>
      <div className={`bg-gray-900 border rounded-xl overflow-hidden hover:border-gray-600 transition-colors flex flex-col relative ${
        isInvalidated ? "border-red-800/60" : "border-gray-800"
      }`}>

        {/* Technicals-invalid overlay banner */}
        {isInvalidated && (
          <div className="absolute inset-x-0 top-0 z-10 bg-red-900/70 border-b border-red-700/60 px-3 py-1.5 text-xs text-red-200 flex items-start gap-1.5">
            <span className="shrink-0">🚫</span>
            <span>
              <span className="font-semibold">Charttechnisches Setup durch News-Event überlagert</span>
              {c.invalidation_reason && (
                <span className="block text-red-300/80 mt-0.5">{c.invalidation_reason}</span>
              )}
            </span>
          </div>
        )}

        {/* Chart thumbnail */}
        {chartFile && !imgError ? (
          <div className={`bg-gray-950 overflow-hidden ${isInvalidated ? "mt-[52px]" : ""}`}>
            <img
              src={`/api/charts/${chartFile}`}
              alt={`${c.ticker} chart`}
              className="w-full h-auto block cursor-pointer"
              onError={() => setImgError(true)}
            />
          </div>
        ) : (
          <div className={`bg-gray-950 flex items-center justify-center text-gray-700 text-xs h-32 ${isInvalidated ? "mt-[52px]" : ""}`}>
            No chart
          </div>
        )}

        <div className="p-3 flex flex-col gap-2 flex-1">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-white font-bold text-base">{c.ticker}</span>
                {c.exchange && <span className="text-gray-600 text-xs">{c.exchange}</span>}
                {/* News icon */}
                {headlines.length > 0 && (
                  <button
                    onClick={() => setShowHeadlines(h => !h)}
                    className={`text-xs px-1.5 py-0.5 rounded border transition ${
                      showHeadlines
                        ? "bg-blue-600/30 border-blue-500/50 text-blue-300"
                        : "bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300"
                    }`}
                    title="News Headlines"
                  >
                    📰
                  </button>
                )}
              </div>
              {c.sector && <span className="text-gray-500 text-xs">{c.sector}</span>}
            </div>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border capitalize ${colorClass}`}>
              {c.setup_type}
            </span>
          </div>

          {/* Flag badges */}
          {hasWarnings && (
            <div className="flex flex-wrap gap-1">
              {flags.map(flag => {
                const cfg = FLAG_CONFIG[flag];
                if (!cfg) return null;
                return (
                  <span key={flag} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${cfg.color}`}>
                    {cfg.label(c)}
                  </span>
                );
              })}
            </div>
          )}

          {/* Headlines dropdown */}
          {showHeadlines && headlines.length > 0 && (
            <div className="bg-gray-800/80 border border-gray-700 rounded-lg p-2 space-y-1.5">
              {headlines.map((h, i) => (
                <p key={i} className="text-xs text-gray-300 leading-snug">
                  <span className="text-gray-500 mr-1">•</span>{h}
                </p>
              ))}
            </div>
          )}

          {c.pattern_name && (
            <p className="text-xs text-gray-500">{c.pattern_name}</p>
          )}

          {/* Confidence */}
          <ConfidenceBar value={c.confidence} />

          {/* Entry / Stop / Target */}
          <div className="grid grid-cols-3 gap-1 text-xs">
            <div className="bg-gray-800 rounded p-1.5">
              <div className="text-gray-500 text-[10px]">Entry</div>
              <div className="text-white font-medium">{c.entry_zone || "—"}</div>
            </div>
            <div className="bg-gray-800 rounded p-1.5">
              <div className="text-gray-500 text-[10px]">Stop</div>
              <div className="text-red-400 font-medium">{c.stop_loss || "—"}</div>
            </div>
            <div className="bg-gray-800 rounded p-1.5">
              <div className="text-gray-500 text-[10px]">Target</div>
              <div className="text-green-400 font-medium">{c.target || "—"}</div>
            </div>
          </div>

          {/* CRV */}
          <CRVBadge crv={c.crv_calculated} crvValid={c.crv_valid} />

          {/* Reasoning */}
          {c.reasoning && (
            <p className="text-xs text-gray-400 leading-relaxed line-clamp-2">{c.reasoning}</p>
          )}

          {/* News warning */}
          {c.news_warning && (
            <div className="flex items-start gap-1.5 p-2 bg-yellow-900/20 border border-yellow-700/30 rounded text-xs text-yellow-300">
              <span className="shrink-0">⚠️</span>
              <span>{c.news_warning}</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-1.5 mt-auto pt-1">
            {c.has_deep_analysis && (
              <button
                onClick={() => setShowDeep(true)}
                className="flex-1 text-xs py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 rounded border border-indigo-500/30 transition"
              >
                Deep Analysis
              </button>
            )}
            <button
              onClick={() => setShowPortfolio(true)}
              className="flex-1 text-xs py-1.5 bg-green-600/20 hover:bg-green-600/40 text-green-400 rounded border border-green-500/30 transition"
            >
              + Portfolio
            </button>
            <button
              onClick={addToWatchlist}
              disabled={addedToWatchlist}
              className="text-xs py-1.5 px-2 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded transition disabled:opacity-50"
            >
              {addedToWatchlist ? "✓" : "Watch"}
            </button>
          </div>
        </div>
      </div>

      {showDeep && (
        <DeepAnalysisModal candidate={c} onClose={() => setShowDeep(false)} />
      )}

      {showPortfolio && (
        <AddPositionModal
          prefill={portfolioPrefill}
          budget={budget}
          onClose={() => setShowPortfolio(false)}
          onSaved={() => setShowPortfolio(false)}
        />
      )}
    </>
  );
}
