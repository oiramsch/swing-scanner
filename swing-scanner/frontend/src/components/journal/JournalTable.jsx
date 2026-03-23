import { useState } from "react";
import TradeReplayModal from "./TradeReplayModal.jsx";

const EMOTION_ICONS = {
  confident: "✅",
  regelbasiert: "✅",
  fomo: "😤",
  unsicher: "😰",
  angst: "😨",
  gierig: "💰",
};

export default function JournalTable({ entries, onEdit, onRefresh }) {
  const [replayEntry, setReplayEntry] = useState(null);

  if (entries.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p>No journal entries yet</p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 text-gray-400 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-3 py-3 text-left">Trade</th>
              <th className="px-3 py-3 text-left">Setup</th>
              <th className="px-3 py-3 text-left">Plan</th>
              <th className="px-3 py-3 text-right">Result</th>
              <th className="px-3 py-3 text-left">Lesson</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {entries.map(e => {
              const pnlPos = (e.pnl_eur || 0) >= 0;
              const rulesOk = e.followed_rules === true;
              const rulesNull = e.followed_rules === null;
              const rowBg = e.pnl_eur !== null
                ? (pnlPos && rulesOk ? "bg-green-950/20" : !pnlPos || e.followed_rules === false ? "bg-red-950/20" : "")
                : "";

              return (
                <tr key={e.id} className={`${rowBg} hover:bg-gray-800/50 transition`}>
                  {/* Col 1: Trade */}
                  <td className="px-3 py-3">
                    <div className="font-bold text-white">{e.ticker}</div>
                    <div className="text-gray-500 text-xs">{e.trade_date}</div>
                  </td>
                  {/* Col 2: Setup */}
                  <td className="px-3 py-3">
                    <div className="text-gray-300 text-xs capitalize">{e.setup_type || "—"}</div>
                    <div className="text-gray-500 text-xs line-clamp-1 max-w-[140px]">{e.setup_reason || "—"}</div>
                  </td>
                  {/* Col 3: Plan */}
                  <td className="px-3 py-3">
                    <div className="text-xs space-y-0.5">
                      <div className="text-gray-400">E: <span className="text-white">${e.entry_price?.toFixed(2)}</span></div>
                      <div className="text-gray-400">S: <span className="text-red-400">${e.stop_loss?.toFixed(2)}</span></div>
                      <div className="text-gray-400">T: <span className="text-green-400">${e.target?.toFixed(2)}</span></div>
                      {e.risk_reward > 0 && <div className="text-yellow-400 text-[10px]">CRV 1:{e.risk_reward?.toFixed(1)}</div>}
                    </div>
                  </td>
                  {/* Col 4: Result */}
                  <td className="px-3 py-3 text-right">
                    {e.pnl_eur !== null ? (
                      <div>
                        <div className={`font-bold ${pnlPos ? "text-green-400" : "text-red-400"}`}>
                          {pnlPos ? "+" : ""}€{e.pnl_eur?.toFixed(2)}
                        </div>
                        <div className={`text-xs ${pnlPos ? "text-green-500" : "text-red-500"}`}>
                          {pnlPos ? "+" : ""}{e.pnl_pct?.toFixed(1)}%
                        </div>
                        {e.exit_date && <div className="text-gray-600 text-xs">{e.exit_date}</div>}
                      </div>
                    ) : (
                      <span className="text-gray-600 text-xs">Open</span>
                    )}
                  </td>
                  {/* Col 5: Lesson */}
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      {e.emotion_entry && (
                        <span title={e.emotion_entry}>{EMOTION_ICONS[e.emotion_entry] || "❓"}</span>
                      )}
                      {e.followed_rules !== null && (
                        <span className={`text-xs ${rulesOk ? "text-green-400" : "text-red-400"}`}>
                          {rulesOk ? "✓ Rules" : "✗ Rules"}
                        </span>
                      )}
                    </div>
                    {e.lesson && (
                      <p className="text-xs text-gray-400 line-clamp-2 max-w-[160px]">{e.lesson}</p>
                    )}
                  </td>
                  {/* Actions */}
                  <td className="px-3 py-3">
                    <div className="flex gap-1">
                      <button onClick={() => onEdit(e)} className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded">
                        Edit
                      </button>
                      {e.exit_price && (
                        <button onClick={() => setReplayEntry(e)} className="text-xs px-2 py-1 bg-indigo-900/30 hover:bg-indigo-900/60 text-indigo-400 rounded">
                          Replay
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {replayEntry && (
        <TradeReplayModal entry={replayEntry} onClose={() => setReplayEntry(null)} />
      )}
    </>
  );
}
