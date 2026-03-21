import { useState } from "react";

const SETUP_BADGE = {
  breakout: "bg-green-500/20 text-green-400 border border-green-500/30",
  pullback: "bg-blue-500/20 text-blue-400 border border-blue-500/30",
  pattern: "bg-purple-500/20 text-purple-400 border border-purple-500/30",
  momentum: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
  none: "bg-gray-500/20 text-gray-400 border border-gray-500/30",
};

function ConfidenceBar({ score }) {
  const pct = (score / 10) * 100;
  const color =
    score >= 8
      ? "bg-green-500"
      : score >= 6
      ? "bg-yellow-500"
      : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-800 rounded-full h-1.5">
        <div
          className={`h-1.5 rounded-full ${color} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-semibold text-gray-300 w-6 text-right">
        {score}
      </span>
    </div>
  );
}

export default function CandidateCard({ candidate }) {
  const [imgError, setImgError] = useState(false);
  const {
    ticker,
    setup_type,
    pattern_name,
    confidence,
    entry_zone,
    stop_loss,
    target,
    reasoning,
  } = candidate;

  const badgeClass = SETUP_BADGE[setup_type] ?? SETUP_BADGE.none;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden hover:border-gray-600 transition-colors flex flex-col">
      {/* Chart thumbnail */}
      <div className="relative bg-gray-950 aspect-square">
        {!imgError ? (
          <img
            src={`/api/charts/${ticker}`}
            alt={`${ticker} chart`}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-600">
            <svg
              className="w-12 h-12"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
        )}
      </div>

      {/* Card body */}
      <div className="p-4 flex flex-col gap-3 flex-1">
        {/* Ticker + badge */}
        <div className="flex items-center justify-between">
          <span className="text-xl font-bold text-white tracking-wide">
            {ticker}
          </span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badgeClass}`}>
            {pattern_name ?? setup_type}
          </span>
        </div>

        {/* Confidence */}
        <div>
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Confidence</span>
            <span>{confidence}/10</span>
          </div>
          <ConfidenceBar score={confidence} />
        </div>

        {/* Trade levels */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="bg-gray-800 rounded-lg p-2">
            <div className="text-gray-500 mb-0.5">Entry</div>
            <div className="text-green-400 font-medium truncate">
              {entry_zone ?? "—"}
            </div>
          </div>
          <div className="bg-gray-800 rounded-lg p-2">
            <div className="text-gray-500 mb-0.5">Stop</div>
            <div className="text-red-400 font-medium truncate">
              {stop_loss ?? "—"}
            </div>
          </div>
          <div className="bg-gray-800 rounded-lg p-2">
            <div className="text-gray-500 mb-0.5">Target</div>
            <div className="text-blue-400 font-medium truncate">
              {target ?? "—"}
            </div>
          </div>
        </div>

        {/* Reasoning */}
        {reasoning && (
          <p className="text-xs text-gray-400 leading-relaxed line-clamp-3">
            {reasoning}
          </p>
        )}
      </div>
    </div>
  );
}
