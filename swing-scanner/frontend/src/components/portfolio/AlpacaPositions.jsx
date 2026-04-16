import React, { useState, useEffect } from "react";
import axios from "axios";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function orderLabel(order) {
  const side = order.side;
  const type = order.type;
  if (side === "sell" && type === "limit")                         return { label: "TP", color: "text-green-400 border-green-700/40 bg-green-900/10" };
  if (side === "sell" && (type === "stop" || type === "stop_limit")) return { label: "SL", color: "text-red-400 border-red-700/40 bg-red-900/10" };
  if (side === "buy")                                              return { label: "BUY", color: "text-blue-400 border-blue-700/40 bg-blue-900/10" };
  return { label: type?.toUpperCase() || "?", color: "text-gray-400 border-gray-700 bg-gray-800/40" };
}

// ---------------------------------------------------------------------------
// Existing order row (TP / SL) — edit + cancel
// ---------------------------------------------------------------------------
function OrderRow({ order, onCancel, onModified }) {
  const [editing, setEditing]         = useState(false);
  const [price, setPrice]             = useState("");
  const [saving, setSaving]           = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const { label, color } = orderLabel(order);
  const isTP = order.side === "sell" && order.type === "limit";
  const isSL = order.side === "sell" && (order.type === "stop" || order.type === "stop_limit");
  const currentPrice = isTP ? order.limit_price : isSL ? (order.stop_price ?? order.limit_price) : order.limit_price;

  async function handleSave() {
    const val = parseFloat(price);
    if (!val || val <= 0) return;
    setSaving(true);
    try {
      const body = isTP ? { limit_price: val } : { stop_price: val };
      const res = await axios.patch(`/api/orders/${order.id}`, body);
      setEditing(false);
      setPrice("");
      onModified(res.data);
    } catch (err) {
      alert(err.response?.data?.detail || "Änderung fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    setConfirmCancel(false);
    try {
      await axios.delete(`/api/orders/${order.id}`);
      onCancel(order.id);
    } catch (err) {
      alert(err.response?.data?.detail || "Stornierung fehlgeschlagen");
    }
  }

  return (
    <tr className="border-t border-gray-800/40 bg-gray-800/20">
      <td className="py-1.5 pr-2 pl-6 text-gray-600 text-[10px]">└</td>
      <td colSpan={4} className="py-1.5 pr-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${color}`}>{label}</span>
          <span className="text-gray-400 text-[11px]">{order.qty} Stk.</span>
          {currentPrice != null && !editing && (
            <span className="text-gray-300 text-[11px] font-mono">@ ${currentPrice.toFixed(2)}</span>
          )}
          {editing && (
            <div className="flex items-center gap-1.5">
              <span className="text-gray-500 text-[11px]">@</span>
              <input
                type="number" step="0.01" value={price}
                onChange={e => setPrice(e.target.value)}
                placeholder={currentPrice?.toFixed(2)}
                className="w-20 px-1.5 py-0.5 text-[11px] bg-gray-700 border border-gray-600 rounded text-white outline-none focus:border-indigo-500"
                autoFocus
                onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") { setEditing(false); setPrice(""); } }}
              />
              <button onClick={handleSave} disabled={saving}
                className="text-[10px] px-2 py-0.5 bg-indigo-700 hover:bg-indigo-600 text-white rounded transition disabled:opacity-50">
                {saving ? "…" : "OK"}
              </button>
              <button onClick={() => { setEditing(false); setPrice(""); }}
                className="text-[10px] px-1.5 py-0.5 text-gray-500 hover:text-gray-300 transition">
                Abbrechen
              </button>
            </div>
          )}
          <span className="text-[10px] px-1 py-0.5 rounded text-gray-500 border border-gray-700">{order.status}</span>
        </div>
      </td>
      <td />
      <td className="text-right py-1.5">
        <div className="flex items-center justify-end gap-1.5">
          {(isTP || isSL) && !editing && (
            <button onClick={() => { setEditing(true); setPrice(currentPrice?.toFixed(2) || ""); }}
              title={isTP ? "Take-Profit anpassen" : "Stop-Loss anpassen"}
              className="text-[10px] px-1.5 py-0.5 text-gray-500 hover:text-indigo-400 border border-gray-700 hover:border-indigo-600 rounded transition">
              ✏
            </button>
          )}
          {confirmCancel ? (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-orange-400">Stornieren?</span>
              <button onClick={handleCancel} className="text-[10px] px-1.5 py-0.5 bg-red-700 hover:bg-red-600 text-white rounded transition">Ja</button>
              <button onClick={() => setConfirmCancel(false)} className="text-[10px] px-1.5 py-0.5 bg-gray-700 text-gray-300 rounded transition">Nein</button>
            </div>
          ) : (
            <button onClick={() => setConfirmCancel(true)}
              className="text-[10px] px-1.5 py-0.5 bg-red-900/20 hover:bg-red-900/50 border border-red-700/30 text-red-400 rounded transition">
              ✕
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// New order form (inline, per position)
// ---------------------------------------------------------------------------
function NewOrderForm({ pos, onClose, onPlaced }) {
  const [orderType, setOrderType] = useState("limit_sell");
  const [price, setPrice]         = useState("");
  const [qty, setQty]             = useState(String(pos.qty));
  const [saving, setSaving]       = useState(false);

  const isLimit = orderType === "limit_sell";

  async function handleSubmit(e) {
    e.preventDefault();
    const val = parseFloat(price);
    const q   = parseFloat(qty);
    if (!val || val <= 0 || !q || q <= 0) return;
    setSaving(true);
    try {
      const res = await axios.post("/api/orders/single", {
        ticker: pos.ticker,
        qty: q,
        type: orderType,
        price: val,
      });
      onPlaced(res.data);
      onClose();
    } catch (err) {
      alert(err.response?.data?.detail || "Order fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="border-t border-gray-800/40 bg-indigo-900/10">
      <td className="py-2 pl-6 pr-2 text-gray-600 text-[10px]">+</td>
      <td colSpan={5} className="py-2 pr-3">
        <form onSubmit={handleSubmit} className="flex items-center gap-2 flex-wrap">
          {/* Order type */}
          <select
            value={orderType}
            onChange={e => setOrderType(e.target.value)}
            className="text-[11px] bg-gray-800 border border-gray-700 text-gray-200 rounded px-2 py-1 outline-none focus:border-indigo-500"
          >
            <option value="limit_sell">Sell Limit (TP)</option>
            <option value="stop_sell">Stop Loss (SL)</option>
          </select>

          {/* Qty */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-500">Stk.</span>
            <input
              type="number" min="1" step="1" value={qty}
              onChange={e => setQty(e.target.value)}
              className="w-16 px-1.5 py-1 text-[11px] bg-gray-700 border border-gray-600 rounded text-white outline-none focus:border-indigo-500"
            />
          </div>

          {/* Price */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-500">{isLimit ? "Limit @" : "Stop @"}</span>
            <input
              type="number" step="0.01" value={price}
              onChange={e => setPrice(e.target.value)}
              placeholder={pos.current_price?.toFixed(2)}
              className="w-24 px-1.5 py-1 text-[11px] bg-gray-700 border border-gray-600 rounded text-white outline-none focus:border-indigo-500"
              autoFocus
              onKeyDown={e => { if (e.key === "Escape") onClose(); }}
            />
          </div>

          <button type="submit" disabled={saving || !price}
            className="text-[11px] px-3 py-1 bg-indigo-700 hover:bg-indigo-600 text-white rounded transition disabled:opacity-50 font-medium">
            {saving ? "…" : "Order setzen"}
          </button>
          <button type="button" onClick={onClose}
            className="text-[11px] px-2 py-1 text-gray-500 hover:text-gray-300 transition">
            Abbrechen
          </button>
        </form>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Planned order row — SL/TP from DB position when no active order exists
// ---------------------------------------------------------------------------
function PlannedOrderRow({ ticker, type, price, qty, onActivated }) {
  const [activating, setActivating] = useState(false);
  const isTP = type === "tp";
  const label = isTP ? "TP" : "SL";
  const color = isTP
    ? "text-green-400 border-green-700/40 bg-green-900/10"
    : "text-red-400 border-red-700/40 bg-red-900/10";

  async function handleActivate() {
    setActivating(true);
    try {
      const res = await axios.post("/api/orders/single", {
        ticker,
        qty,
        type: isTP ? "limit_sell" : "stop_sell",
        price,
      });
      onActivated(res.data);
    } catch (err) {
      alert(err.response?.data?.detail || "Order fehlgeschlagen");
    } finally {
      setActivating(false);
    }
  }

  return (
    <tr className="border-t border-gray-800/40 bg-gray-800/10">
      <td className="py-1.5 pr-2 pl-6 text-gray-700 text-[10px]">└</td>
      <td colSpan={4} className="py-1.5 pr-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${color} opacity-50`}>{label}</span>
          <span className="text-gray-600 text-[11px]">{qty} Stk.</span>
          <span className="text-gray-500 text-[11px] font-mono">@ ${price?.toFixed(2)}</span>
          <span className="text-[10px] px-1 py-0.5 rounded text-gray-600 border border-gray-800 italic">geplant</span>
        </div>
      </td>
      <td />
      <td className="text-right py-1.5">
        <button
          onClick={handleActivate}
          disabled={activating}
          title={`${label}-Order zum geplanten Preis aktivieren`}
          className="text-[10px] px-2 py-0.5 bg-indigo-900/30 hover:bg-indigo-700/50 border border-indigo-700/40 text-indigo-400 hover:text-indigo-200 rounded transition disabled:opacity-50"
        >
          {activating ? "…" : "Aktivieren"}
        </button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function AlpacaPositions() {
  const [positions,   setPositions]   = useState(null);
  const [orders,      setOrders]      = useState([]);
  const [dbPositions, setDbPositions] = useState({});   // ticker → DB PortfolioPosition
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [selling,     setSelling]     = useState({});
  const [addingFor,   setAddingFor]   = useState(null);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    setError(null);
    try {
      const [posRes, ordRes, dbRes] = await Promise.allSettled([
        axios.get("/api/portfolio/alpaca"),
        axios.get("/api/orders"),
        axios.get("/api/portfolio"),
      ]);
      setPositions(posRes.status === "fulfilled" ? posRes.value.data : []);
      setOrders(ordRes.status === "fulfilled" ? ordRes.value.data : []);
      if (posRes.status === "rejected") {
        const msg = posRes.reason?.response?.data?.detail ?? posRes.reason?.message;
        setError(msg);
      }
      // Build ticker → DB position map for planned SL/TP display
      if (dbRes.status === "fulfilled") {
        const map = {};
        for (const p of dbRes.value.data?.positions ?? []) {
          map[p.ticker] = p;
        }
        setDbPositions(map);
      }
    } finally {
      setLoading(false);
    }
  }

  // Group sell-side orders by ticker
  const ordersByTicker = {};
  for (const o of orders) {
    if (o.side !== "sell") continue;
    if (!ordersByTicker[o.ticker]) ordersByTicker[o.ticker] = [];
    ordersByTicker[o.ticker].push(o);
  }

  function handleOrderCancelled(orderId) {
    setOrders(prev => prev.filter(o => o.id !== orderId));
  }

  function handleOrderModified(updated) {
    setOrders(prev => prev.map(o => o.id === updated.id ? updated : o));
  }

  function handleOrderPlaced(newOrder) {
    setOrders(prev => [...prev, newOrder]);
  }

  async function handleSell(pos) {
    if (!window.confirm(`Market-Sell ${pos.qty} × ${pos.ticker} zu aktuellem Kurs bestätigen?`)) return;
    setSelling(s => ({ ...s, [pos.ticker]: true }));
    try {
      await axios.post("/api/orders/sell", { ticker: pos.ticker, qty: pos.qty });
      await fetchAll();
    } catch (err) {
      alert("Fehler: " + (err.response?.data?.detail ?? err.message));
    } finally {
      setSelling(s => { const n = { ...s }; delete n[pos.ticker]; return n; });
    }
  }

  if (loading) return <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 animate-pulse h-24" />;
  if (error && (error.includes("No broker") || error.includes("not configured"))) return null;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-white font-semibold text-sm">Alpaca Positionen</h2>
          <span className="text-[10px] px-1.5 py-0.5 bg-yellow-900/40 text-yellow-300 border border-yellow-700/40 rounded font-semibold">
            PAPER
          </span>
        </div>
        <button onClick={fetchAll} className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded" title="Aktualisieren">↻</button>
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}
      {!error && positions?.length === 0 && <p className="text-gray-500 text-sm">Keine offenen Positionen bei Alpaca.</p>}

      {positions?.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left py-2 pr-3">Ticker</th>
                <th className="text-right pr-3">Qty</th>
                <th className="text-right pr-3">Ø Einstieg</th>
                <th className="text-right pr-3">Aktuell</th>
                <th className="text-right pr-3">Market Value</th>
                <th className="text-right pr-3">P&L</th>
                <th className="text-right">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => {
                const plPct     = pos.unrealized_plpc != null ? (pos.unrealized_plpc * 100) : null;
                const plAbs     = pos.unrealized_pl;
                const isPos     = (plAbs ?? 0) >= 0;
                const posOrders = ordersByTicker[pos.ticker] || [];
                const isAdding  = addingFor === pos.ticker;
                const dbPos     = dbPositions[pos.ticker];

                // Determine which planned orders to show (only when no active order of that type)
                const hasActiveTP = posOrders.some(o => o.side === "sell" && o.type === "limit");
                const hasActiveSL = posOrders.some(o => o.side === "sell" && (o.type === "stop" || o.type === "stop_limit"));
                const showPlannedTP = !hasActiveTP && dbPos?.target != null;
                const showPlannedSL = !hasActiveSL && dbPos?.stop_loss != null;

                return (
                  <React.Fragment key={pos.ticker}>
                    {/* Position row */}
                    <tr className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="py-2 pr-3 font-semibold text-white">{pos.ticker}</td>
                      <td className="text-right pr-3 text-gray-300">{pos.qty}</td>
                      <td className="text-right pr-3 text-gray-300">${pos.avg_entry_price?.toFixed(2)}</td>
                      <td className="text-right pr-3 text-gray-300">
                        {pos.current_price != null ? `$${pos.current_price.toFixed(2)}` : "—"}
                      </td>
                      <td className="text-right pr-3 text-gray-300">
                        {pos.market_value != null ? `$${pos.market_value.toFixed(2)}` : "—"}
                      </td>
                      <td className={`text-right pr-3 font-medium ${isPos ? "text-green-400" : "text-red-400"}`}>
                        {plAbs != null ? `${isPos ? "+" : ""}$${plAbs.toFixed(2)}` : "—"}
                        {plPct != null && (
                          <span className="ml-1 text-[10px] opacity-70">({isPos ? "+" : ""}{plPct.toFixed(2)}%)</span>
                        )}
                      </td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setAddingFor(isAdding ? null : pos.ticker)}
                            title="Neue Order setzen (TP / SL)"
                            className={`px-2 py-1 text-[10px] rounded border transition font-bold ${
                              isAdding
                                ? "bg-indigo-800/50 border-indigo-600/60 text-indigo-300"
                                : "bg-gray-800 hover:bg-indigo-900/30 border-gray-700 hover:border-indigo-600/50 text-gray-400 hover:text-indigo-300"
                            }`}
                          >
                            +
                          </button>
                          <button
                            onClick={() => handleSell(pos)}
                            disabled={!!selling[pos.ticker]}
                            className="px-2 py-1 text-[10px] bg-red-700/30 hover:bg-red-700/60 text-red-300 border border-red-700/40 rounded disabled:opacity-50 transition"
                          >
                            {selling[pos.ticker] ? (
                              <span className="inline-block w-2.5 h-2.5 border border-red-300 border-t-transparent rounded-full animate-spin" />
                            ) : "Sell"}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* New order form (inline, below position) */}
                    {isAdding && (
                      <NewOrderForm
                        pos={pos}
                        onClose={() => setAddingFor(null)}
                        onPlaced={handleOrderPlaced}
                      />
                    )}

                    {/* Active child orders (TP + SL) */}
                    {posOrders.map(order => (
                      <OrderRow
                        key={order.id}
                        order={order}
                        onCancel={handleOrderCancelled}
                        onModified={handleOrderModified}
                      />
                    ))}

                    {/* Planned orders from DB — shown when no active order of that type exists */}
                    {showPlannedTP && (
                      <PlannedOrderRow
                        ticker={pos.ticker}
                        type="tp"
                        price={dbPos.target}
                        qty={pos.qty}
                        onActivated={handleOrderPlaced}
                      />
                    )}
                    {showPlannedSL && (
                      <PlannedOrderRow
                        ticker={pos.ticker}
                        type="sl"
                        price={dbPos.stop_loss}
                        qty={pos.qty}
                        onActivated={handleOrderPlaced}
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
