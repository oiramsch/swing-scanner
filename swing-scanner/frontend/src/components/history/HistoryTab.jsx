import { useState, useEffect } from "react";
import axios from "axios";

const SETUP_COLORS = {
  breakout: "bg-green-500",
  pullback: "bg-blue-500",
  pattern: "bg-purple-500",
  momentum: "bg-yellow-500",
};

export default function HistoryTab() {
  const [calendar, setCalendar] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [dateResults, setDateResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingDay, setLoadingDay] = useState(false);

  useEffect(() => {
    fetchCalendar();
  }, []);

  async function fetchCalendar() {
    setLoading(true);
    try {
      const res = await axios.get("/api/history/calendar");
      setCalendar(res.data);
    } finally { setLoading(false); }
  }

  async function selectDate(d) {
    setSelectedDate(d);
    setLoadingDay(true);
    try {
      const res = await axios.get(`/api/history/${d}`);
      setDateResults(res.data);
    } finally { setLoadingDay(false); }
  }

  // Group by month
  const byMonth = {};
  calendar.forEach(item => {
    const [y, m] = item.date.split("-");
    const key = `${y}-${m}`;
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(item);
  });

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <h2 className="text-white font-semibold">Scan History</h2>

      {loading ? (
        <div className="h-48 bg-gray-900 rounded-xl animate-pulse" />
      ) : calendar.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <p>No scan history yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Calendar */}
          <div className="lg:col-span-1 space-y-4">
            {Object.entries(byMonth)
              .sort((a, b) => b[0].localeCompare(a[0]))
              .map(([month, days]) => {
                const [y, m] = month.split("-");
                const monthName = new Date(parseInt(y), parseInt(m) - 1).toLocaleString("en-US", { month: "long", year: "numeric" });
                return (
                  <div key={month} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                    <div className="text-gray-400 text-xs font-semibold mb-2">{monthName}</div>
                    <div className="space-y-1">
                      {days.map(item => (
                        <button
                          key={item.date}
                          onClick={() => selectDate(item.date)}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition ${
                            selectedDate === item.date
                              ? "bg-indigo-600 text-white"
                              : "bg-gray-800 hover:bg-gray-700 text-gray-300"
                          }`}
                        >
                          <span>{item.date}</span>
                          <div className="flex items-center gap-2">
                            {item.setup_types?.slice(0, 3).map(st => (
                              <span key={st} className={`w-2 h-2 rounded-full ${SETUP_COLORS[st] || "bg-gray-500"}`} />
                            ))}
                            <span className="text-xs font-medium">{item.count}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>

          {/* Day results */}
          <div className="lg:col-span-2">
            {!selectedDate && (
              <div className="flex items-center justify-center h-48 text-gray-500">
                Select a date to view candidates
              </div>
            )}
            {loadingDay && (
              <div className="grid grid-cols-2 gap-3">
                {[...Array(4)].map((_, i) => <div key={i} className="bg-gray-900 h-32 rounded-xl animate-pulse" />)}
              </div>
            )}
            {selectedDate && !loadingDay && (
              <>
                <div className="text-gray-400 text-sm mb-3">{dateResults.length} candidates on {selectedDate}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {dateResults.map(c => (
                    <div key={c.id} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-white font-bold">{c.ticker}</span>
                          {c.has_deep_analysis && (
                            <span className="text-xs px-1.5 py-0.5 bg-pink-900/50 text-pink-400 border border-pink-700/40 rounded-full">Deep AI</span>
                          )}
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${SETUP_COLORS[c.setup_type] ? "text-white" : "text-gray-400"} ${SETUP_COLORS[c.setup_type] || "bg-gray-700"}`}>
                          {c.setup_type}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400">Confidence: {c.confidence}/10</div>
                      {c.entry_zone && <div className="text-xs text-gray-500">Entry: {c.entry_zone}</div>}
                      {c.reasoning && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{c.reasoning}</p>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
