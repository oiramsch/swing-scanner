const ACTION_COLORS = {
  hold: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  reduce: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  close: "bg-red-500/20 text-red-300 border-red-500/30",
  add: "bg-green-500/20 text-green-300 border-green-500/30",
};

const URGENCY_COLORS = {
  immediate: "text-red-400",
  this_week: "text-yellow-400",
  monitor: "text-gray-400",
};

const RISK_COLORS = {
  low: "text-green-400",
  medium: "text-yellow-400",
  high: "text-red-400",
};

export default function PortfolioAIReport({ report, onClose }) {
  if (!report) return null;
  const summary = report.portfolio_summary || {};
  const positions = report.positions || [];

  return (
    <div className="bg-gray-900 border border-indigo-800/40 rounded-xl p-4 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-white font-semibold">KI Portfolio-Analyse</h3>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-gray-400 text-xs">Overall risk:</span>
            <span className={`text-xs font-bold capitalize ${RISK_COLORS[summary.overall_risk] || "text-gray-400"}`}>
              {summary.overall_risk}
            </span>
          </div>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
      </div>

      {summary.recommendation && (
        <p className="text-sm text-gray-300 p-3 bg-gray-800 rounded-lg">{summary.recommendation}</p>
      )}

      {summary.diversification && (
        <p className="text-xs text-gray-400">{summary.diversification}</p>
      )}

      {positions.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-gray-500 font-medium uppercase tracking-wide">Position Recommendations</div>
          {positions.map((p, i) => (
            <div key={i} className="flex items-start gap-3 p-2 bg-gray-800 rounded-lg">
              <div className="flex-shrink-0">
                <span className="text-white font-bold text-sm">{p.ticker}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-2 py-0.5 rounded border capitalize ${ACTION_COLORS[p.action] || ACTION_COLORS.hold}`}>
                    {p.action}
                  </span>
                  <span className={`text-xs capitalize ${URGENCY_COLORS[p.urgency] || "text-gray-400"}`}>
                    {p.urgency}
                  </span>
                </div>
                <p className="text-xs text-gray-400">{p.reason}</p>
                {p.suggested_stop_adjustment && (
                  <p className="text-xs text-orange-400 mt-0.5">New stop: {p.suggested_stop_adjustment}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {report.watchout && (
        <div className="p-3 bg-yellow-900/20 border border-yellow-800/30 rounded-lg">
          <div className="text-yellow-400 text-xs font-medium mb-1">⚠️ Watch Out</div>
          <p className="text-xs text-gray-300">{report.watchout}</p>
        </div>
      )}
    </div>
  );
}
