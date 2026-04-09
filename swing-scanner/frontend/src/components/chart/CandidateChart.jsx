/**
 * CandidateChart — Phase A + Phase B
 *
 * Phase A: Interactive candlestick chart with SMA50/200, Entry/SL/TP price lines,
 *          period selector, volume histogram.
 * Phase B: Drawing toolbar (Horizontal Line, Trendline, Fibonacci Retracement),
 *          Canvas overlay for trendlines + fibonacci, LocalStorage persistence.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { createChart, CrosshairMode, LineStyle } from "lightweight-charts";
import { Minus, TrendingUp, BarChart2, Trash2, X, Loader } from "lucide-react";
import axios from "axios";

// ── Constants ──────────────────────────────────────────────────────────────
const PERIODS = [
  { label: "1M", value: "1mo" },
  { label: "3M", value: "3mo" },
  { label: "6M", value: "6mo" },
  { label: "1Y", value: "1y" },
];

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_COLORS = [
  "#6b7280", // 0%
  "#f59e0b", // 23.6%
  "#10b981", // 38.2%
  "#3b82f6", // 50%
  "#8b5cf6", // 61.8%
  "#ec4899", // 78.6%
  "#6b7280", // 100%
];

const CHART_OPTS = {
  layout: { background: { color: "#0f172a" }, textColor: "#94a3b8" },
  grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
  crosshair: { mode: CrosshairMode.Normal },
  rightPriceScale: { borderColor: "#334155" },
  timeScale: { borderColor: "#334155", timeVisible: false },
};

let _idCounter = 0;
function uid() { return ++_idCounter; }

// ── Helper ─────────────────────────────────────────────────────────────────
function loadDrawings(symbol) {
  try {
    const raw = localStorage.getItem(`chart_drawings_${symbol}`);
    return raw ? JSON.parse(raw) : { horizontalLines: [], trendlines: [], fibonaccis: [] };
  } catch { return { horizontalLines: [], trendlines: [], fibonaccis: [] }; }
}

function saveDrawings(symbol, drawings) {
  try { localStorage.setItem(`chart_drawings_${symbol}`, JSON.stringify(drawings)); } catch {}
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function CandidateChart({ symbol, scanResult, onClose }) {
  const containerRef = useRef(null);
  const canvasRef    = useRef(null);
  const chartRef     = useRef(null);
  const candleRef    = useRef(null);
  const volRef       = useRef(null);
  const priceLineRefs = useRef({}); // id → priceLine object

  const [period, setPeriod] = useState("3mo");
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);
  const [activeTool, setActiveTool] = useState(null); // 'horizontal' | 'trendline' | 'fibonacci' | null
  const [pendingPoint, setPendingPoint] = useState(null); // first click for 2-point tools
  const [drawings, setDrawings] = useState(() => loadDrawings(symbol));

  // ── Chart initialisation ─────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      ...CHART_OPTS,
      width: containerRef.current.clientWidth,
      height: 420,
    });
    chartRef.current = chart;

    // Candlestick series
    const candle = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    candleRef.current = candle;

    // Volume series (separate pane)
    const vol = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      color: "#334155",
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volRef.current = vol;

    // Resize observer
    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: containerRef.current?.clientWidth ?? 600 });
      drawCanvas();
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volRef.current = null;
    };
  }, []);

  // ── Fetch data when period changes ────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    axios.get(`/api/chart/${symbol}?period=${period}`).then(res => {
      if (cancelled || !candleRef.current) return;
      const { bars, indicators } = res.data;

      candleRef.current.setData(bars);
      volRef.current.setData(bars.map(b => ({
        time: b.time,
        value: b.volume,
        color: b.close >= b.open ? "#22c55e33" : "#ef444433",
      })));

      // Remove old SMA lines before re-adding
      chartRef.current.removeSeries?.(chartRef.current._sma50);
      chartRef.current.removeSeries?.(chartRef.current._sma200);

      const sma50 = chartRef.current.addLineSeries({
        color: "#f97316",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      sma50.setData(indicators.sma50);
      chartRef.current._sma50 = sma50;

      const sma200 = chartRef.current.addLineSeries({
        color: "#3b82f6",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      sma200.setData(indicators.sma200);
      chartRef.current._sma200 = sma200;

      // Entry / SL / TP price lines from scanResult prop
      if (scanResult) {
        const addPL = (price, color, title) => {
          if (!price) return;
          candleRef.current.createPriceLine({
            price: parseFloat(price),
            color,
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title,
          });
        };
        // entry_zone might be "148.50–152.00" — split on dash
        if (scanResult.entry_zone) {
          const parts = scanResult.entry_zone.replace("–", "-").split("-");
          if (parts.length === 2) {
            addPL(parts[0].trim(), "#22c55e", "Entry Low");
            addPL(parts[1].trim(), "#22c55e", "Entry High");
          }
        }
        addPL(scanResult.stop_loss,  "#ef4444", "SL");
        addPL(scanResult.target,     "#3b82f6", "TP");
      }

      // Re-apply horizontal drawings as price lines
      priceLineRefs.current = {};
      drawings.horizontalLines.forEach(d => {
        const pl = candleRef.current.createPriceLine({
          price: d.price,
          color: "#f59e0b",
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: "H",
        });
        priceLineRefs.current[d.id] = pl;
      });

      chartRef.current.timeScale().fitContent();
      setLoading(false);
    }).catch(err => {
      if (!cancelled) { setError(err.response?.data?.detail ?? "Fehler beim Laden"); setLoading(false); }
    });

    return () => { cancelled = true; };
  }, [period, symbol]);

  // ── Persist drawings to localStorage ─────────────────────────────────────
  useEffect(() => {
    saveDrawings(symbol, drawings);
  }, [drawings, symbol]);

  // ── Canvas draw ───────────────────────────────────────────────────────────
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const chart  = chartRef.current;
    const series = candleRef.current;
    if (!canvas || !chart || !series) return;

    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = canvas.offsetWidth  * dpr;
    canvas.height = canvas.offsetHeight * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);

    function toXY(time, price) {
      const x = chart.timeScale().timeToCoordinate(time);
      const y = series.priceToCoordinate(price);
      return { x, y };
    }

    // Draw trendlines
    drawings.trendlines.forEach(d => {
      const p1 = toXY(d.point1.time, d.point1.price);
      const p2 = toXY(d.point2.time, d.point2.price);
      if (p1.x == null || p2.x == null || p1.y == null || p2.y == null) return;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    });

    // Draw fibonacci retracements
    drawings.fibonaccis.forEach(d => {
      const high  = Math.max(d.point1.price, d.point2.price);
      const low   = Math.min(d.point1.price, d.point2.price);
      const range = high - low;
      const x1 = toXY(d.point1.time, d.point1.price).x;
      const x2 = toXY(d.point2.time, d.point2.price).x;
      if (x1 == null || x2 == null) return;
      const minX = Math.min(x1, x2);
      const maxX = Math.max(x1, x2);

      FIB_LEVELS.forEach((lvl, i) => {
        const price = high - range * lvl;
        const y = series.priceToCoordinate(price);
        if (y == null) return;
        ctx.beginPath();
        ctx.moveTo(minX, y);
        ctx.lineTo(maxX, y);
        ctx.strokeStyle = FIB_COLORS[i];
        ctx.lineWidth   = 1;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = FIB_COLORS[i];
        ctx.font = "10px sans-serif";
        ctx.fillText(`${(lvl * 100).toFixed(1)}%  $${price.toFixed(2)}`, maxX + 4, y + 4);
      });
    });

    // Pending point indicator (half-drawn trendline / fib)
    if (pendingPoint) {
      const p = toXY(pendingPoint.time, pendingPoint.price);
      if (p.x != null && p.y != null) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, 2 * Math.PI);
        ctx.fillStyle = "#f59e0b";
        ctx.fill();
      }
    }
  }, [drawings, pendingPoint]);

  // Redraw canvas when drawings/pendingPoint change
  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  // Redraw after chart scroll/zoom
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const handler = () => drawCanvas();
    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
  }, [drawCanvas]);

  // ── Click handler for drawing tools ──────────────────────────────────────
  useEffect(() => {
    const chart  = chartRef.current;
    const series = candleRef.current;
    if (!chart || !series || !activeTool) return;

    const handler = (param) => {
      if (!param.point) return;
      const price = series.coordinateToPrice(param.point.y);
      const time  = param.time; // can be undefined if not on a bar — use approximate
      if (price == null) return;

      // If no bar time, try to derive from x coordinate
      const t = time ?? chart.timeScale().coordinateToTime(param.point.x);

      if (activeTool === "horizontal") {
        const id = uid();
        const pl = series.createPriceLine({
          price,
          color: "#f59e0b",
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: "H",
        });
        priceLineRefs.current[id] = pl;
        setDrawings(prev => ({
          ...prev,
          horizontalLines: [...prev.horizontalLines, { id, price }],
        }));
        setActiveTool(null);
      } else if (activeTool === "trendline" || activeTool === "fibonacci") {
        if (!t) return; // need a time anchor
        if (!pendingPoint) {
          setPendingPoint({ time: t, price });
        } else {
          const id = uid();
          if (activeTool === "trendline") {
            setDrawings(prev => ({
              ...prev,
              trendlines: [...prev.trendlines, {
                id,
                point1: pendingPoint,
                point2: { time: t, price },
              }],
            }));
          } else {
            setDrawings(prev => ({
              ...prev,
              fibonaccis: [...prev.fibonaccis, {
                id,
                point1: pendingPoint,
                point2: { time: t, price },
              }],
            }));
          }
          setPendingPoint(null);
          setActiveTool(null);
        }
      }
    };

    chart.subscribeClick(handler);
    return () => chart.unsubscribeClick(handler);
  }, [activeTool, pendingPoint]);

  // ── Right-click to delete nearest drawing ─────────────────────────────────
  useEffect(() => {
    const chart  = chartRef.current;
    const series = candleRef.current;
    if (!chart || !series) return;

    const el = chart.chartElement();
    if (!el) return;

    const handler = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx   = e.clientX - rect.left;
      const my   = e.clientY - rect.top;

      // Find closest horizontal line within 8px
      let bestId   = null;
      let bestDist = 12;

      drawings.horizontalLines.forEach(d => {
        const y = series.priceToCoordinate(d.price);
        if (y == null) return;
        const dist = Math.abs(y - my);
        if (dist < bestDist) { bestDist = dist; bestId = { type: "horizontal", id: d.id }; }
      });

      // Trendlines — distance from point to segment
      drawings.trendlines.forEach(d => {
        const p1 = series.priceToCoordinate(d.point1.price);
        const p2 = series.priceToCoordinate(d.point2.price);
        const x1 = chart.timeScale().timeToCoordinate(d.point1.time);
        const x2 = chart.timeScale().timeToCoordinate(d.point2.time);
        if (p1 == null || p2 == null || x1 == null || x2 == null) return;
        const dx = x2 - x1, dy = p2 - p1;
        const len2 = dx * dx + dy * dy;
        if (len2 === 0) return;
        const t = Math.max(0, Math.min(1, ((mx - x1) * dx + (my - p1) * dy) / len2));
        const dist = Math.hypot(mx - (x1 + t * dx), my - (p1 + t * dy));
        if (dist < bestDist) { bestDist = dist; bestId = { type: "trendline", id: d.id }; }
      });

      if (!bestId) return;

      if (bestId.type === "horizontal") {
        const pl = priceLineRefs.current[bestId.id];
        if (pl) { series.removePriceLine(pl); delete priceLineRefs.current[bestId.id]; }
        setDrawings(prev => ({
          ...prev,
          horizontalLines: prev.horizontalLines.filter(d => d.id !== bestId.id),
        }));
      } else if (bestId.type === "trendline") {
        setDrawings(prev => ({
          ...prev,
          trendlines: prev.trendlines.filter(d => d.id !== bestId.id),
        }));
      } else if (bestId.type === "fibonacci") {
        setDrawings(prev => ({
          ...prev,
          fibonaccis: prev.fibonaccis.filter(d => d.id !== bestId.id),
        }));
      }
    };

    el.addEventListener("contextmenu", handler);
    return () => el.removeEventListener("contextmenu", handler);
  }, [drawings]);

  // ── Clear all drawings ────────────────────────────────────────────────────
  function clearAll() {
    // Remove all horizontal price lines
    Object.values(priceLineRefs.current).forEach(pl => {
      try { candleRef.current?.removePriceLine(pl); } catch {}
    });
    priceLineRefs.current = {};
    setDrawings({ horizontalLines: [], trendlines: [], fibonaccis: [] });
    setPendingPoint(null);
    setActiveTool(null);
  }

  const toolActive = (t) => activeTool === t;

  return (
    <div className="flex flex-col gap-0 bg-gray-950 rounded-xl overflow-hidden" style={{ minWidth: 0 }}>
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <span className="text-white font-bold text-base">{symbol}</span>

          {/* Period buttons */}
          <div className="flex gap-1">
            {PERIODS.map(p => (
              <button
                key={p.value}
                onClick={() => { setPeriod(p.value); }}
                className={`text-xs px-2 py-0.5 rounded transition ${
                  period === p.value
                    ? "bg-indigo-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Drawing toolbar */}
        <div className="flex items-center gap-1.5">
          <button
            title="Horizontale Linie"
            onClick={() => setActiveTool(t => t === "horizontal" ? null : "horizontal")}
            className={`p-1.5 rounded transition ${toolActive("horizontal") ? "bg-amber-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
          >
            <Minus size={14} />
          </button>
          <button
            title="Trendlinie"
            onClick={() => { setActiveTool(t => t === "trendline" ? null : "trendline"); setPendingPoint(null); }}
            className={`p-1.5 rounded transition ${toolActive("trendline") ? "bg-amber-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
          >
            <TrendingUp size={14} />
          </button>
          <button
            title="Fibonacci Retracement"
            onClick={() => { setActiveTool(t => t === "fibonacci" ? null : "fibonacci"); setPendingPoint(null); }}
            className={`p-1.5 rounded transition ${toolActive("fibonacci") ? "bg-amber-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
          >
            <BarChart2 size={14} />
          </button>
          <button
            title="Alle löschen"
            onClick={clearAll}
            className="p-1.5 rounded bg-gray-800 text-gray-400 hover:bg-red-900/40 hover:text-red-400 transition"
          >
            <Trash2 size={14} />
          </button>

          <div className="w-px h-4 bg-gray-700 mx-1" />

          <button
            onClick={onClose}
            className="p-1.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700 transition"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Tool hint */}
      {activeTool && (
        <div className="px-4 py-1 bg-amber-900/20 border-b border-amber-700/30 text-xs text-amber-400">
          {activeTool === "horizontal" && "Klick auf Chart → horizontale Linie setzen"}
          {activeTool === "trendline"  && (!pendingPoint ? "1. Punkt klicken…" : "2. Punkt klicken → Trendlinie fertig")}
          {activeTool === "fibonacci"  && (!pendingPoint ? "Hoch/Tief klicken…" : "2. Punkt klicken → Fibonacci fertig")}
        </div>
      )}

      {/* ── Chart area ── */}
      <div className="relative" style={{ height: 420 }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-950/80 z-20">
            <Loader size={24} className="text-indigo-400 animate-spin" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center z-20">
            <span className="text-red-400 text-sm">{error}</span>
          </div>
        )}
        {/* Lightweight-charts mounts here */}
        <div ref={containerRef} className="w-full h-full" />
        {/* Canvas overlay for trendlines + fibonacci */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ zIndex: 10 }}
        />
      </div>
    </div>
  );
}
