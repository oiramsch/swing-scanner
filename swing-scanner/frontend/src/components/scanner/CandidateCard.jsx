import { useState } from "react";
import axios from "axios";
import DeepAnalysisModal from "./DeepAnalysisModal.jsx";
import AddPositionModal from "../portfolio/AddPositionModal.jsx";
import OrderForm from "../trading/OrderForm.jsx";

const SETUP_COLORS = {
  breakout: "bg-green-500/20 text-green-400 border-green-500/30",
  pullback: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  pattern: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  momentum: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  none: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

const MODULE_COLORS = {
  "Bull Breakout":          "bg-green-500/15 text-green-400 border-green-500/30",
  "Bear Relative Strength": "bg-orange-500/15 text-orange-300 border-orange-500/30",
  "Mean Reversion":         "bg-purple-500/15 text-purple-300 border-purple-500/30",
};
const MODULE_ICONS = {
  "Bull Breakout":          "🚀",
  "Bear Relative Strength": "🛡️",
  "Mean Reversion":         "🔄",
};

const FLAG_CONFIG = {
  gap_up:             { label: (c) => `GAP UP +${c.gap_pct?.toFixed(1)}%`,  color: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" },
  gap_down:           { label: (c) => `GAP DOWN ${c.gap_pct?.toFixed(1)}%`, color: "bg-orange-500/20 text-orange-300 border-orange-500/30" },
  post_earnings:      { label: () => "POST-EARNINGS",        color: "bg-orange-500/20 text-orange-300 border-orange-500/30" },
  pre_earnings:       { label: () => "EARNINGS BALD",        color: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" },
  corporate_action:   { label: () => "CORPORATE ACTION",     color: "bg-red-500/20 text-red-300 border-red-500/30" },
  low_crv:            { label: (c) => `CRV: ${c.crv_calculated?.toFixed(1)} ⛔`, color: "bg-orange-500/20 text-orange-300 border-orange-500/30" },
  technicals_invalid: { label: () => "CHARTTECHNIK UNGÜLTIG", color: "bg-red-500/20 text-red-300 border-red-500/30" },
};

function ConfidenceBar({ confidence, compositeScore }) {
  const pct = (confidence / 10) * 100;
  const color = confidence >= 8 ? "bg-green-500" : confidence >= 6 ? "bg-yellow-500" : "bg-red-500";
  const hasScore = compositeScore != null && compositeScore !== confidence;
  const scoreDiff = hasScore ? compositeScore - confidence : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-400 w-4 text-right">{confidence}</span>
      {hasScore && (
        <span
          className={`text-[11px] font-semibold tabular-nums ${scoreDiff > 0 ? "text-green-400" : "text-orange-400"}`}
          title={`Score = Conf ${confidence} × CRV-Faktor = ${compositeScore}`}
        >
          →{compositeScore.toFixed(1)}
        </span>
      )}
    </div>
  );
}

function CRVBadge({ crv, crvValid }) {
  if (!crv) return null;
  const color = crvValid === false
    ? "text-red-400"
    : crv >= 2.0 ? "text-green-400"
    : crv >= 1.5 ? "text-yellow-400"
    : "text-red-400";
  const icon = crvValid === false ? "⛔" : crv >= 2.0 ? "✅" : crv >= 1.5 ? "⚠️" : "⛔";
  return (
    <span className={`text-xs font-medium ${color}`}>
      CRV: {crv.toFixed(1)} {icon}
    </span>
  );
}

// 1.3 — Parse entry zone into structured trigger price display
// "150.00-152.00" → { low: 150, high: 152, trigger: 152 }
// "150.00"        → { low: 150, high: null, trigger: 150 }
function parseEntryZone(entryZone) {
  if (!entryZone) return null;
  const nums = String(entryZone).match(/[\d.]+/g)?.map(Number) ?? [];
  if (nums.length === 0) return null;
  if (nums.length === 1) return { low: nums[0], high: null, trigger: nums[0] };
  const [lo, hi] = [Math.min(...nums), Math.max(...nums)];
  return { low: lo, high: hi, trigger: hi };
}

// Legacy: first number only (used elsewhere)
function parseEntryPrice(entryZone) {
  if (!entryZone) return "";
  const match = String(entryZone).match(/[\d.]+/);
  return match ? match[0] : "";
}

function parseFlags(flagsJson) {
  if (!flagsJson) return [];
  try { return typeof flagsJson === "string" ? JSON.parse(flagsJson) : flagsJson; }
  catch { return []; }
}

function parseHeadlines(headlinesJson) {
  if (!headlinesJson) return [];
  try { return typeof headlinesJson === "string" ? JSON.parse(headlinesJson) : headlinesJson; }
  catch { return []; }
}

// 1.5 — Chart lightbox for full-screen zoom on mobile tap
function ChartLightbox({ src, ticker, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="relative max-w-full max-h-full" onClick={e => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute -top-8 right-0 text-gray-400 hover:text-white text-sm"
        >
          ✕ Schließen
        </button>
        <img
          src={src}
          alt={`${ticker} chart`}
          className="max-w-[95vw] max-h-[85vh] object-contain rounded-lg"
        />
        <p className="text-center text-gray-500 text-xs mt-2">{ticker} — Chart</p>
      </div>
    </div>
  );
}

export default function CandidateCard({ candidate: c, budget = null }) {
  const [showDeep, setShowDeep] = useState(false);
  const [showPortfolio, setShowPortfolio] = useState(false);
  const [showOrder, setShowOrder] = useState(false);
  const [showHeadlines, setShowHeadlines] = useState(false);
  const [showChart, setShowChart] = useState(false);    // 1.5 lightbox
  const [showDimmed, setShowDimmed] = useState(false);  // 1.3 override dim
  const [imgError, setImgError] = useState(false);
  const [addedToWatchlist, setAddedToWatchlist] = useState(false);

  const colorClass = SETUP_COLORS[c.setup_type] || SETUP_COLORS.none;
  const chartFile = c.chart_path ? c.chart_path.split("/").pop() : null;
  const chartSrc = chartFile ? `/api/charts/${chartFile}` : null;
  const flags = parseFlags(c.flags);
  const headlines = parseHeadlines(c.news_headlines);

  // 1.3 — classify card quality
  const isInvalidated   = flags.includes("technicals_invalid");
  const hasCorporateAction = flags.includes("corporate_action");
  // Dim cards with invalidated technicals (unless user overrides)
  const isDimmed = isInvalidated && !showDimmed;

  const nonTechFlags = flags.filter(f => f !== "technicals_invalid");

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

  // 1.3 — entry zone parsed
  const entryZoneParsed = parseEntryZone(c.entry_zone);

  return (
    <>
      {/* 1.5 Chart Lightbox */}
      {showChart && chartSrc && (
        <ChartLightbox src={chartSrc} ticker={c.ticker} onClose={() => setShowChart(false)} />
      )}

      <div className={`bg-gray-900 border rounded-xl overflow-hidden transition-colors flex flex-col relative ${
        isDimmed
          ? "border-red-900/40 opacity-40 grayscale hover:opacity-80 hover:grayscale-0 cursor-pointer"
          : isInvalidated
          ? "border-red-800/60 hover:border-gray-600"
          : "border-gray-800 hover:border-gray-600"
      }`}
        onClick={isDimmed ? () => setShowDimmed(true) : undefined}
      >

        {/* 1.3 — Technicals-invalid dim overlay with "einblenden" hint */}
        {isDimmed && (
          <div className="absolute inset-0 z-20 flex items-center justify-center">
            <span className="bg-gray-900/80 text-red-400 text-xs px-3 py-1.5 rounded-lg border border-red-800/50 pointer-events-none">
              🚫 Charttechnik ungültig — tippen zum Einblenden
            </span>
          </div>
        )}

        {/* 1.3 — Invalidation banner (only when user opted to show dimmed card) */}
        {isInvalidated && !isDimmed && (
          <div className="bg-red-900/70 border-b border-red-700/60 px-3 py-1.5 text-xs text-red-200 flex items-start gap-1.5">
            <span className="shrink-0">🚫</span>
            <span className="flex-1">
              <span className="font-semibold">Charttechnik durch News-Event überlagert</span>
              {c.invalidation_reason && (
                <span className="block text-red-300/80 mt-0.5">{c.invalidation_reason}</span>
              )}
            </span>
            <button
              onClick={() => setShowDimmed(true)}
              className="shrink-0 text-red-400/60 hover:text-red-300 text-[10px] border border-red-800/40 px-1.5 py-0.5 rounded"
            >
              dimmen
            </button>
          </div>
        )}

        {/* 1.3 — Corporate action prominent warning */}
        {hasCorporateAction && !isDimmed && (
          <div className="bg-red-950/80 border-b border-red-700 px-3 py-2 text-xs text-red-200 flex items-center gap-2">
            <span className="text-base shrink-0">⚠️</span>
            <div>
              <span className="font-bold text-red-300">CORPORATE ACTION</span>
              <span className="text-red-400/70 ml-1">— Setup kann durch Ereignis ungültig sein</span>
            </div>
          </div>
        )}

        {/* Chart thumbnail — 1.5 tap-to-zoom */}
        {chartSrc && !imgError ? (
          <div className="bg-gray-950 overflow-hidden">
            <img
              src={chartSrc}
              alt={`${c.ticker} chart`}
              className="w-full h-auto block cursor-zoom-in active:opacity-80 transition-opacity"
              onClick={e => { e.stopPropagation(); setShowChart(true); }}
              onError={() => setImgError(true)}
            />
          </div>
        ) : (
          <div className="bg-gray-950 flex items-center justify-center text-gray-700 text-xs h-32">
            No chart
          </div>
        )}

        <div className={`p-3 flex flex-col gap-2 flex-1 ${isDimmed ? "pointer-events-none select-none" : ""}`}>
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-white font-bold text-base">{c.ticker}</span>
                {c.exchange && <span className="text-gray-600 text-xs">{c.exchange}</span>}
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

          {/* Strategy module tag */}
          {c.strategy_module && (
            <div className="flex items-center gap-1">
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                MODULE_COLORS[c.strategy_module] ?? "bg-gray-700/50 text-gray-400 border-gray-600"
              }`}>
                {MODULE_ICONS[c.strategy_module] ?? "📊"} {c.strategy_module}
              </span>
            </div>
          )}

          {/* Non-critical flag badges (exclude corporate_action + technicals_invalid — shown separately above) */}
          {nonTechFlags.filter(f => f !== "corporate_action").length > 0 && (
            <div className="flex flex-wrap gap-1">
              {nonTechFlags.filter(f => f !== "corporate_action").map(flag => {
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

          {/* Confidence + composite score */}
          <ConfidenceBar confidence={c.confidence} compositeScore={c.composite_score} />

          {/* 1.3 — Entry / Stop / Target with trigger price */}
          <div className="grid grid-cols-3 gap-1 text-xs">
            <div className="bg-gray-800 rounded p-1.5">
              <div className="text-gray-500 text-[10px]">Entry</div>
              <div className="text-white font-medium leading-tight">
                {entryZoneParsed ? (
                  entryZoneParsed.high
                    ? <>${entryZoneParsed.low}–{entryZoneParsed.high}</>
                    : <>${entryZoneParsed.low}</>
                ) : (c.entry_zone || "—")}
              </div>
              {entryZoneParsed?.high && (
                <div className="text-indigo-400 text-[10px] mt-0.5">
                  Trigger ≤${entryZoneParsed.high}
                </div>
              )}
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
          <div className="flex gap-1.5 mt-auto pt-1 flex-wrap">
            {c.has_deep_analysis && (
              <button
                onClick={() => setShowDeep(true)}
                className="flex-1 text-xs py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 rounded border border-indigo-500/30 transition"
              >
                Deep Analysis
              </button>
            )}
            {c.entry_zone && c.stop_loss && (
              <button
                onClick={() => setShowOrder(true)}
                className="flex-1 text-xs py-1.5 bg-green-700/30 hover:bg-green-700/60 text-green-300 rounded border border-green-600/40 transition font-medium"
              >
                Kaufen
              </button>
            )}
            <button
              onClick={() => setShowPortfolio(true)}
              className="flex-1 text-xs py-1.5 bg-gray-700/40 hover:bg-gray-700/70 text-gray-300 rounded border border-gray-600/40 transition"
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
      {showOrder && (
        <OrderForm
          candidate={c}
          onClose={() => setShowOrder(false)}
          onSuccess={() => setShowOrder(false)}
        />
      )}
    </>
  );
}
