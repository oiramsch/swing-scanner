import { useState, useEffect } from "react";
import axios from "axios";
import JournalTable from "./JournalTable.jsx";
import JournalEntryForm from "./JournalEntryForm.jsx";

export default function JournalTab() {
  const [entries, setEntries] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ ticker: "", setup_type: "", followed_rules: "" });
  const [showForm, setShowForm] = useState(false);
  const [editEntry, setEditEntry] = useState(null);

  useEffect(() => { fetchEntries(); fetchStats(); }, []);

  async function fetchEntries() {
    setLoading(true);
    try {
      const params = {};
      if (filters.ticker) params.ticker = filters.ticker;
      if (filters.setup_type) params.setup_type = filters.setup_type;
      if (filters.followed_rules !== "") params.followed_rules = filters.followed_rules === "true";
      const res = await axios.get("/api/journal", { params });
      setEntries(res.data);
    } finally { setLoading(false); }
  }

  async function fetchStats() {
    try {
      const res = await axios.get("/api/journal/stats");
      setStats(res.data);
    } catch {}
  }

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      {/* Stats sidebar row */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-gray-900 rounded-xl p-3">
            <div className="text-gray-400 text-xs">Total Trades</div>
            <div className="text-white font-bold text-xl">{stats.total_trades}</div>
          </div>
          <div className="bg-gray-900 rounded-xl p-3">
            <div className="text-gray-400 text-xs">Win Rate</div>
            <div className="text-green-400 font-bold text-xl">{stats.win_rate_overall}%</div>
          </div>
          <div className="bg-gray-900 rounded-xl p-3">
            <div className="text-gray-400 text-xs">Rules Followed</div>
            <div className="text-blue-400 font-bold text-xl">{stats.win_rate_rules_followed}%</div>
            <div className="text-gray-600 text-xs">win rate</div>
          </div>
          <div className="bg-gray-900 rounded-xl p-3">
            <div className="text-gray-400 text-xs">Rules Broken</div>
            <div className="text-red-400 font-bold text-xl">{stats.win_rate_rules_broken}%</div>
            <div className="text-gray-600 text-xs">win rate</div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          placeholder="Ticker filter…"
          value={filters.ticker}
          onChange={e => setFilters(f => ({ ...f, ticker: e.target.value }))}
          className="bg-gray-900 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-2 w-28"
        />
        <select value={filters.setup_type} onChange={e => setFilters(f => ({ ...f, setup_type: e.target.value }))}
          className="bg-gray-900 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-2">
          <option value="">All setups</option>
          <option value="breakout">Breakout</option>
          <option value="pullback">Pullback</option>
          <option value="pattern">Pattern</option>
          <option value="momentum">Momentum</option>
          <option value="fomo">FOMO</option>
        </select>
        <select value={filters.followed_rules} onChange={e => setFilters(f => ({ ...f, followed_rules: e.target.value }))}
          className="bg-gray-900 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-2">
          <option value="">All</option>
          <option value="true">Rules followed</option>
          <option value="false">Rules broken</option>
        </select>
        <button onClick={fetchEntries}
          className="text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-2 rounded-lg">Apply</button>
        <button onClick={() => { setEditEntry(null); setShowForm(true); }}
          className="ml-auto text-sm px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium">
          + New Entry
        </button>
      </div>

      {loading ? (
        <div className="h-48 bg-gray-900 rounded-xl animate-pulse" />
      ) : (
        <JournalTable
          entries={entries}
          onEdit={entry => { setEditEntry(entry); setShowForm(true); }}
          onRefresh={() => { fetchEntries(); fetchStats(); }}
        />
      )}

      {showForm && (
        <JournalEntryForm
          entry={editEntry}
          onClose={() => setShowForm(false)}
          onSaved={() => { fetchEntries(); fetchStats(); setShowForm(false); }}
        />
      )}
    </div>
  );
}
