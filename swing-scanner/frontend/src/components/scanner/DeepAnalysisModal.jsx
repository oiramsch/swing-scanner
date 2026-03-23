const REC_COLORS = {
  strong_buy: "bg-green-500 text-white",
  buy: "bg-green-700/40 text-green-300 border border-green-600",
  watch: "bg-yellow-700/40 text-yellow-300 border border-yellow-600",
  avoid: "bg-red-700/40 text-red-300 border border-red-600",
};

const TIMING_LABELS = {
  now: "Enter Now",
  wait_for_pullback: "Wait for Pullback",
  wait_for_confirmation: "Wait for Confirmation",
};

export default function DeepAnalysisModal({ candidate: c, onClose }) {
  const deep = c.deep_analysis || (c.deep_analysis_json ? JSON.parse(c.deep_analysis_json) : null);

  if (!deep) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="p-5">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-white">{c.ticker} — Deep Analysis</h2>
              <p className="text-gray-400 text-sm">{c.setup_type} · Confidence {c.confidence}/10</p>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">✕</button>
          </div>

          {/* Recommendation badge */}
          {deep.recommendation && (
            <div className={`inline-block px-4 py-2 rounded-xl text-sm font-bold mb-4 capitalize ${REC_COLORS[deep.recommendation] || REC_COLORS.watch}`}>
              {deep.recommendation?.replace("_", " ").toUpperCase()}
            </div>
          )}

          {/* Score */}
          {deep.overall_score && (
            <div className="flex items-center gap-2 mb-4">
              <span className="text-gray-400 text-sm">Overall Score:</span>
              <span className="text-2xl font-bold text-white">{deep.overall_score}</span>
              <span className="text-gray-600">/10</span>
            </div>
          )}

          {/* Setup quality */}
          {deep.setup_quality && (
            <p className="text-gray-300 text-sm mb-4 p-3 bg-gray-800 rounded-lg">{deep.setup_quality}</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            {/* Bull case */}
            {deep.bull_case && (
              <div className="p-3 bg-green-900/20 border border-green-800/40 rounded-lg">
                <div className="text-green-400 text-xs font-semibold mb-1">Bull Case</div>
                <p className="text-gray-300 text-xs">{deep.bull_case}</p>
              </div>
            )}
            {/* Bear case */}
            {deep.bear_case && (
              <div className="p-3 bg-red-900/20 border border-red-800/40 rounded-lg">
                <div className="text-red-400 text-xs font-semibold mb-1">Bear Case</div>
                <p className="text-gray-300 text-xs">{deep.bear_case}</p>
              </div>
            )}
          </div>

          {/* Entry timing */}
          {deep.entry_timing && (
            <div className="mb-3 p-3 bg-gray-800 rounded-lg">
              <div className="text-yellow-400 text-xs font-semibold mb-1">
                Entry Timing: {TIMING_LABELS[deep.entry_timing] || deep.entry_timing}
              </div>
              {deep.entry_timing_reason && (
                <p className="text-gray-300 text-xs">{deep.entry_timing_reason}</p>
              )}
            </div>
          )}

          {/* Key levels */}
          {deep.key_levels && (
            <div className="mb-3 grid grid-cols-3 gap-2">
              {Object.entries(deep.key_levels).map(([key, val]) => (
                <div key={key} className="bg-gray-800 rounded p-2 text-center">
                  <div className="text-gray-500 text-[10px] capitalize">{key.replace(/_/g, " ")}</div>
                  <div className="text-white text-sm font-medium">{val}</div>
                </div>
              ))}
            </div>
          )}

          {/* Context */}
          {(deep.sector_context || deep.market_context) && (
            <div className="space-y-2 mb-3">
              {deep.sector_context && (
                <div className="text-xs text-gray-400">
                  <span className="text-gray-500 font-medium">Sector: </span>{deep.sector_context}
                </div>
              )}
              {deep.market_context && (
                <div className="text-xs text-gray-400">
                  <span className="text-gray-500 font-medium">Market: </span>{deep.market_context}
                </div>
              )}
            </div>
          )}

          {deep.time_horizon && (
            <div className="text-xs text-gray-400">
              <span className="text-gray-500 font-medium">Time horizon: </span>{deep.time_horizon}
            </div>
          )}

          {deep.position_sizing_note && (
            <div className="mt-3 p-2 bg-indigo-900/20 border border-indigo-800/30 rounded text-xs text-indigo-300">
              {deep.position_sizing_note}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
