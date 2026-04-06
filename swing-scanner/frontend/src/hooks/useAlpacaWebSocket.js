import { useState, useEffect, useRef, useCallback } from "react";

const WS_URL = "wss://stream.data.alpaca.markets/v2/iex";
const MAX_SYMBOLS = 30;

// DST-aware US market hours check
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

// Hook: useAlpacaWebSocket(tickers)
// Returns: { prices: {AAPL: 182.50, ...}, connected: bool, isMock: bool, error: string|null }
export function useAlpacaWebSocket(tickers) {
  const [prices, setPrices] = useState({});
  const [connected, setConnected] = useState(false);
  const [isMock, setIsMock] = useState(false);
  const [error, setError] = useState(null);

  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const backoff = useRef(1000);
  const mockTimer = useRef(null);
  const mounted = useRef(true);
  const tickersRef = useRef(tickers);

  useEffect(() => {
    tickersRef.current = tickers;
  }, [tickers]);

  const stopMock = useCallback(() => {
    clearInterval(mockTimer.current);
    mockTimer.current = null;
  }, []);

  const startMock = useCallback(() => {
    setIsMock(true);
    clearInterval(mockTimer.current);
    mockTimer.current = setInterval(() => {
      if (!mounted.current) return;
      setPrices(prev => {
        const next = { ...prev };
        for (const t of tickersRef.current) {
          const base = prev[t] || 100;
          next[t] = parseFloat((base * (1 + (Math.random() * 0.01 - 0.005))).toFixed(2));
        }
        return next;
      });
    }, 2000);
  }, []);

  const connect = useCallback(() => {
    if (!mounted.current) return;

    const useMock = import.meta.env.VITE_MOCK_WEBSOCKET === "true" || !isMarketHours();
    if (useMock) {
      startMock();
      return;
    }

    const limited = tickersRef.current.slice(0, MAX_SYMBOLS);
    if (limited.length === 0) return;

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mounted.current) { ws.close(); return; }
        ws.send(JSON.stringify({ action: "subscribe", trades: limited }));
        backoff.current = 1000;
      };

      ws.onmessage = (evt) => {
        if (!mounted.current) return;
        try {
          const msgs = JSON.parse(evt.data);
          for (const msg of msgs) {
            if (msg.T === "success" && msg.msg === "connected") {
              setConnected(true);
              setIsMock(false);
              stopMock();
              setError(null);
            } else if (msg.T === "t") {
              // trade: msg.S = symbol, msg.p = price
              setPrices(prev => ({ ...prev, [msg.S]: msg.p }));
            } else if (msg.T === "error") {
              setError(msg.msg || "WebSocket-Fehler");
            }
          }
        } catch {}
      };

      ws.onerror = () => {
        if (!mounted.current) return;
        setError("Verbindungsfehler");
        setConnected(false);
      };

      ws.onclose = () => {
        if (!mounted.current) return;
        setConnected(false);
        startMock();
        reconnectTimer.current = setTimeout(() => {
          if (!mounted.current) return;
          backoff.current = Math.min(backoff.current * 2, 30000);
          connect();
        }, backoff.current);
      };
    } catch {
      startMock();
    }
  }, [startMock, stopMock]);

  useEffect(() => {
    mounted.current = true;
    connect();
    return () => {
      mounted.current = false;
      clearTimeout(reconnectTimer.current);
      clearInterval(mockTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-subscribe when tickers change while WS is open
  useEffect(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const limited = tickers.slice(0, MAX_SYMBOLS);
    wsRef.current.send(JSON.stringify({ action: "subscribe", trades: limited }));
  }, [tickers]);

  return { prices, connected, isMock, error };
}
