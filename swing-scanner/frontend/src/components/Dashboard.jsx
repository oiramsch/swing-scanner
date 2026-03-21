import CandidateCard from "./CandidateCard.jsx";

const SETUP_COLORS = {
  breakout: "bg-green-500",
  pullback: "bg-blue-500",
  pattern: "bg-purple-500",
  momentum: "bg-yellow-500",
  none: "bg-gray-500",
};

export default function Dashboard({
  candidates,
  loading,
  error,
  scanStatus,
  lastFetched,
  onScanTrigger,
  onRefresh,
}) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">
            Swing Scanner
          </h1>
          <p className="text-gray-400 mt-1 text-sm">{today}</p>
        </div>

        <div className="flex items-center gap-3">
          {lastFetched && (
            <span className="text-xs text-gray-500">
              Updated {lastFetched.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={onRefresh}
            disabled={loading}
            className="px-3 py-2 text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            onClick={onScanTrigger}
            disabled={scanStatus?.running}
            className="px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {scanStatus?.running ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Scanning…
              </>
            ) : (
              "Scan starten"
            )}
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex gap-4 mb-6 flex-wrap">
        {["breakout", "pullback", "pattern", "momentum"].map((type) => {
          const count = candidates.filter((c) => c.setup_type === type).length;
          return (
            <div
              key={type}
              className="flex items-center gap-2 bg-gray-900 rounded-lg px-4 py-2"
            >
              <span
                className={`w-2 h-2 rounded-full ${SETUP_COLORS[type]}`}
              />
              <span className="text-gray-400 text-sm capitalize">{type}</span>
              <span className="text-white font-semibold text-sm">{count}</span>
            </div>
          );
        })}
        <div className="flex items-center gap-2 bg-gray-900 rounded-lg px-4 py-2 ml-auto">
          <span className="text-gray-400 text-sm">Total</span>
          <span className="text-white font-semibold text-sm">
            {candidates.length}
          </span>
        </div>
      </div>

      {/* Last scan info */}
      {scanStatus?.last_scan && !scanStatus.running && (
        <div className="mb-6 p-3 bg-gray-900 rounded-lg text-sm text-gray-400">
          Last scan:{" "}
          <span className="text-gray-200">
            {scanStatus.last_scan.scan_date}
          </span>{" "}
          — {scanStatus.last_scan.saved ?? 0} results saved,{" "}
          {scanStatus.last_scan.candidates_screened ?? 0} screened
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="bg-gray-900 rounded-xl h-80 animate-pulse"
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && candidates.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-gray-500">
          <svg
            className="w-16 h-16 mb-4 opacity-30"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
          <p className="text-lg font-medium">No candidates for today</p>
          <p className="text-sm mt-1">
            Click "Scan starten" to run the daily scan.
          </p>
        </div>
      )}

      {/* Candidate grid */}
      {!loading && candidates.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {candidates.map((c) => (
            <CandidateCard key={c.id} candidate={c} />
          ))}
        </div>
      )}
    </div>
  );
}
