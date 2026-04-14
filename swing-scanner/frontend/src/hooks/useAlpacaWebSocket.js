/**
 * useAlpacaWebSocket — simplified to HTTP polling via /api/quotes (yfinance backend).
 *
 * Direct Alpaca WebSocket from the browser is not viable because:
 *   1. API keys are stored encrypted on the backend — not accessible in the browser.
 *   2. Alpaca requires authentication before subscribe, which would expose keys client-side.
 *
 * The /api/quotes endpoint (yfinance) is sufficient for swing-trading latency.
 * Polls every 15 s during market hours, every 60 s otherwise.
 */
import { useState, useEffect, useRef } from "react";

function isMarketHours() {
  const now = new Date();
  const yr = now.getUTCFullYear();
  const march1Day = new Date(Date.UTC(yr, 2, 1)).getUTCDay();
  const dstStartDay = 1 + ((7 - march1Day) % 7) + 7;
  const dstStartUTC = new Date(Date.UTC(yr, 2, dstStartDay, 7, 0, 0));
  const nov1Day = new Date(Date.UTC(yr, 10, 1)).getUTCDay();
  const dstEndDay = 1 + ((7 - nov1Day) % 7);
  const dstEndUTC = new Date(Date.UTC(yr, 10, dstEndDay, 6, 0, 0));
  const isEDT = now >= dstStartUTC && now < dstEndUTC;
  const utcOffset = isEDT ? 4 : 5;
  const etNow = new Date(now.getTime() - utcOffset * 3600000);
  const etDay = etNow.getUTCDay();
  const etMins = etNow.getUTCHours() * 60 + etNow.getUTCMinutes();
  return etDay >= 1 && etDay <= 5 && etMins >= 9 * 60 + 30 && etMins < 16 * 60;
}

export function useAlpacaWebSocket(tickers) {
  const [prices, setPrices]       = useState({});
  const [lastUpdate, setLastUpdate] = useState(null);
  const [hasData, setHasData]     = useState(false);
  const tickersKey = tickers.join(",");
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!tickersKey) return;

    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/quotes?symbols=${tickersKey}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const priceMap = {};
        for (const [sym, q] of Object.entries(data)) {
          if (q.price != null) priceMap[sym] = q.price;
        }
        if (!cancelled) {
          setPrices(priceMap);
          setLastUpdate(new Date());
          setHasData(true);
        }
      } catch { /* network error — silently retry next interval */ }
    }

    poll();

    function startInterval() {
      clearInterval(intervalRef.current);
      const ms = isMarketHours() ? 15_000 : 60_000;
      intervalRef.current = setInterval(() => {
        poll();
        // Re-schedule with current market-hours interval each tick
        startInterval();
      }, ms);
    }
    startInterval();

    return () => {
      cancelled = true;
      clearInterval(intervalRef.current);
    };
  }, [tickersKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep signature compatible with old WebSocket hook:
  // connected=true once we have data, isMock=false always
  return { prices, connected: hasData, isMock: false, lastUpdate };
}
