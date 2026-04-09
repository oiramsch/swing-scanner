/**
 * DealCockpitCharts — Phase B
 *
 * Shows all active TradePlans (status: pending / active / partial) as
 * mini intraday candlestick charts (15-min bars, 5 days) in a 2-column grid.
 * Entry, SL, and TP are drawn as price lines. Data refreshes every 60 seconds.
 */
import { useEffect, useRef, useState } from "react";
import { createChart, CrosshairMode, LineStyle } from "lightweight-charts";
import { RefreshCw } from "lucide-react";
import axios from "axios";

const MINI_HEIGHT = 200;

const CHART_OPTS = {
  layout: { background: { color: "#0f172a" }, textColor: "#94a3b8" },
  grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
  crosshair: { mode: CrosshairMode.Normal },
  rightPriceScale: { borderColor: "#334155" },
  timeScale: {
    borderColor: "#334155",
    timeVisible: true,
    secondsVisible: false,
  },
  handleScroll: false,
  handleScale: false,
};

// ── Single mini-chart tile ─────────────────────────────────────────────────
function MiniChart({ plan }) {
  const containerRef = useRef(null);
  const chartRef     = useRef(null);
  const candleRef    = useRef(null);
  const [error, setError] = useState(null);

  function applyPlanLines(series, planData) {
    if (!planData) return;
    const add = (price, color, title) => {
      if (price == null) return;
      series.createPriceLine({
        price,
        color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title,
      });
    };
    add(planData.entry_low,  "#22c55e", "Entry L");
    add(planData.entry_high, "#22c55e", "Entry H");
    add(planData.stop_loss,  "#ef4444", "SL");
    add(planData.target,     "#3b82f6", "TP");
  }

  async function loadData() {
    if (!candleRef.current) return;
    try {
      const res = await axios.get(`/api/chart/${plan.ticker}/intraday`);
      const { bars, plan: planData } = res.data;
      if (!candleRef.current) return;
      candleRef.current.setData(bars);
      applyPlanLines(candleRef.current, planData);
      chartRef.current?.timeScale().fitContent();
      setError(null);
    } catch (err) {
      setError(err.response?.data?.detail ?? "Fehler");
    }
  }

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      ...CHART_OPTS,
      width: containerRef.current.clientWidth || 320,
      height: MINI_HEIGHT,
    });
    chartRef.current = chart;

    const candle = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    candleRef.current = candle;

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: containerRef.current?.clientWidth ?? 320 });
    });
    ro.observe(containerRef.current);

    loadData();

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
    };
  }, [plan.ticker]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-white font-bold text-sm">{plan.ticker}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
            plan.status === "pending" ? "bg-gray-800 text-gray-400" :
            plan.status === "active"  ? "bg-green-900/40 text-green-400" :
            "bg-yellow-900/40 text-yellow-400"
          }`}>
            {plan.status.toUpperCase()}
          </span>
        </div>
        <div className="text-[10px] text-gray-600 flex gap-2">
          {plan.entry_high && <span className="text-green-400">E ${plan.entry_high}</span>}
          {plan.stop_loss  && <span className="text-red-400">SL ${plan.stop_loss}</span>}
          {plan.target     && <span className="text-blue-400">TP ${plan.target}</span>}
        </div>
      </div>
      {error ? (
        <div className="flex items-center justify-center text-red-400 text-xs" style={{ height: MINI_HEIGHT }}>
          {error}
        </div>
      ) : (
        <div ref={containerRef} style={{ height: MINI_HEIGHT }} />
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function DealCockpitCharts({ plans }) {
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [tick, setTick] = useState(0);
  const intervalRef = useRef(null);

  // Live-update every 60 seconds — increment tick to force MiniChart remount/reload
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setTick(t => t + 1);
      setLastUpdate(new Date());
    }, 60_000);
    return () => clearInterval(intervalRef.current);
  }, []);

  const activePlans = plans.filter(p => ["pending", "active", "partial"].includes(p.status));

  if (activePlans.length === 0) {
    return (
      <div className="text-center py-8 text-gray-600 text-sm">
        Keine aktiven Pläne für Mini-Charts.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">
          Intraday 15min · 5 Tage · {activePlans.length} Chart{activePlans.length !== 1 ? "s" : ""}
        </span>
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <RefreshCw size={10} />
          <span>
            Update: {lastUpdate.toLocaleTimeString("de", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            {" · "}alle 60s
          </span>
        </div>
      </div>

      {/* 2-column grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {activePlans.map(plan => (
          <MiniChart key={`${plan.id}-${tick}`} plan={plan} />
        ))}
      </div>
    </div>
  );
}
