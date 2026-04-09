import { useEffect, useRef, useState, useCallback } from "react";
import { createChart, CrosshairMode } from "lightweight-charts";
import axios from "axios";

const PERIODS = [
  { label: "1M", value: "1mo" },
  { label: "3M", value: "3mo" },
  { label: "6M", value: "6mo" },
  { label: "1Y", value: "1y" },
];

// Parse entry zone string like "150.00-152.00" or "150.00"
function parseEntryZone(entryZone) {
  if (!entryZone) return null;
  const nums = String(entryZone).match(/[\d.]+/g)?.map(Number) ?? [];
  if (nums.length === 0) return null;
  if (nums.length === 1) return { low: nums[0], high: nums[0] };
  return { low: Math.min(...nums), high: Math.max(...nums) };
}

function parsePrice(value) {
  if (!value) return null;
  const match = String(value).match(/[\d.]+/);
  return match ? parseFloat(match[0]) : null;
}

export default function CandidateChart({ symbol, scanResult, onClose }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const [selectedPeriod, setSelectedPeriod] = useState("3mo");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const initChart = useCallback(() => {
    if (!containerRef.current) return;

    // Destroy previous chart if any
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const container = containerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: 420,
      layout: {
        background: { color: "#0f0f0f" },
        textColor: "#9ca3af",
      },
      grid: {
        vertLines: { color: "#1f2937" },
        horzLines: { color: "#1f2937" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: "#374151",
      },
      timeScale: {
        borderColor: "#374151",
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartRef.current = chart;
    return chart;
  }, []);

  const loadData = useCallback(
    async (period) => {
      if (!containerRef.current) return;
      setLoading(true);
      setError(null);

      try {
        const res = await axios.get(`/api/chart/${symbol}`, { params: { period } });
        const { bars, indicators } = res.data;

        const chart = initChart();
        if (!chart) return;

        // --- Candlestick series ---
        const candleSeries = chart.addCandlestickSeries({
          upColor: "#22c55e",
          downColor: "#ef4444",
          borderUpColor: "#22c55e",
          borderDownColor: "#ef4444",
          wickUpColor: "#22c55e",
          wickDownColor: "#ef4444",
        });
        candleSeries.setData(bars);

        // --- Volume histogram (separate pane) ---
        const volumeSeries = chart.addHistogramSeries({
          color: "#374151",
          priceFormat: { type: "volume" },
          priceScaleId: "volume",
        });
        chart.priceScale("volume").applyOptions({
          scaleMargins: { top: 0.8, bottom: 0 },
        });
        volumeSeries.setData(
          bars.map((b) => ({
            time: b.time,
            value: b.volume,
            color: b.close >= b.open ? "#22c55e40" : "#ef444440",
          }))
        );

        // --- SMA50 overlay (orange, thin) ---
        if (indicators.sma50?.length > 0) {
          const sma50Series = chart.addLineSeries({
            color: "#f97316",
            lineWidth: 1,
            title: "SMA50",
            priceLineVisible: false,
            lastValueVisible: false,
          });
          sma50Series.setData(indicators.sma50);
        }

        // --- SMA200 overlay (blue, thin) ---
        if (indicators.sma200?.length > 0) {
          const sma200Series = chart.addLineSeries({
            color: "#3b82f6",
            lineWidth: 1,
            title: "SMA200",
            priceLineVisible: false,
            lastValueVisible: false,
          });
          sma200Series.setData(indicators.sma200);
        }

        // --- Price lines from scan result ---
        if (scanResult) {
          const entryZone = parseEntryZone(scanResult.entry_zone);
          const stopLoss = parsePrice(scanResult.stop_loss);
          const target = parsePrice(scanResult.target);

          // Entry low (green dashed)
          if (entryZone?.low) {
            candleSeries.createPriceLine({
              price: entryZone.low,
              color: "#22c55e",
              lineWidth: 1,
              lineStyle: 2, // dashed
              axisLabelVisible: true,
              title: "Entry Low",
            });
          }

          // Entry high (green dashed) — only if range
          if (entryZone?.high && entryZone.high !== entryZone.low) {
            candleSeries.createPriceLine({
              price: entryZone.high,
              color: "#22c55e",
              lineWidth: 1,
              lineStyle: 2, // dashed
              axisLabelVisible: true,
              title: "Entry High",
            });
          }

          // Stop loss (red solid)
          if (stopLoss) {
            candleSeries.createPriceLine({
              price: stopLoss,
              color: "#ef4444",
              lineWidth: 1,
              lineStyle: 0, // solid
              axisLabelVisible: true,
              title: "SL",
            });
          }

          // Target price (blue solid)
          if (target) {
            candleSeries.createPriceLine({
              price: target,
              color: "#60a5fa",
              lineWidth: 1,
              lineStyle: 0, // solid
              axisLabelVisible: true,
              title: "TP",
            });
          }
        }

        chart.timeScale().fitContent();
      } catch (err) {
        setError(err.response?.data?.detail ?? err.message ?? "Fehler beim Laden");
      } finally {
        setLoading(false);
      }
    },
    [symbol, scanResult, initChart]
  );

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      if (chartRef.current && containerRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    const observer = new ResizeObserver(handleResize);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Load data whenever period changes
  useEffect(() => {
    loadData(selectedPeriod);
    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [selectedPeriod, loadData]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-gray-950 border border-gray-800 rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <span className="text-white font-bold text-lg">{symbol}</span>
            {scanResult && (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                {scanResult.entry_zone && (
                  <span className="text-green-400">Entry: {scanResult.entry_zone}</span>
                )}
                {scanResult.stop_loss && (
                  <span className="text-red-400">SL: {scanResult.stop_loss}</span>
                )}
                {scanResult.target && (
                  <span className="text-blue-400">TP: {scanResult.target}</span>
                )}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-200 text-sm px-2 py-1 rounded hover:bg-gray-800 transition"
          >
            ✕
          </button>
        </div>

        {/* Period buttons */}
        <div className="flex items-center gap-2 px-5 py-2 border-b border-gray-800/50">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setSelectedPeriod(p.value)}
              className={`text-xs px-3 py-1 rounded transition ${
                selectedPeriod === p.value
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700"
              }`}
            >
              {p.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-3 text-[11px] text-gray-600">
            <span className="flex items-center gap-1">
              <span className="w-4 h-0.5 bg-orange-400 inline-block" /> SMA50
            </span>
            <span className="flex items-center gap-1">
              <span className="w-4 h-0.5 bg-blue-400 inline-block" /> SMA200
            </span>
            <span className="flex items-center gap-1">
              <span className="w-4 h-px border-t border-dashed border-green-400 inline-block" /> Entry
            </span>
          </div>
        </div>

        {/* Chart area */}
        <div className="relative" style={{ minHeight: 420 }}>
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-950/80 z-10">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-gray-500">Lade Chart…</span>
              </div>
            </div>
          )}
          {error && !loading && (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <div className="text-center text-red-400 text-sm p-8">
                <p className="font-semibold mb-1">Fehler beim Laden</p>
                <p className="text-xs text-red-500">{error}</p>
              </div>
            </div>
          )}
          <div ref={containerRef} className="w-full" />
        </div>
      </div>
    </div>
  );
}
