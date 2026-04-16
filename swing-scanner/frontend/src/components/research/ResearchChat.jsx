/**
 * ResearchChat — interaktiver KI-Assistent für einen Ticker.
 * Startet automatisch mit einer initialen Analyse und erlaubt freie Folgefragen.
 * Gesamtes Gespräch wird per ticker+datum in localStorage gecacht — beim Ticker-
 * Wechsel und zurück ist das komplette Chat-Verlauf sofort wieder da.
 * Wenn die KI Trade-Parameter vorschlägt, erscheint ein "Plan erstellen ↗" Button.
 */
import { useState, useEffect, useRef } from "react";
import axios from "axios";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function cacheKey(ticker) {
  return `research_analysis_${ticker}_${todayStr()}`;
}

export default function ResearchChat({ ticker, onSuggestPlan }) {
  const [messages,  setMessages]  = useState([]);
  const [input,     setInput]     = useState("");
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);
  const bottomRef   = useRef(null);
  const inputRef    = useRef(null);
  // Track the ticker that is active when a request is sent — ignore stale responses
  const activeTicker = useRef(ticker);

  // Re-start chat when ticker changes; restore full conversation from cache if available
  useEffect(() => {
    if (!ticker) return;
    activeTicker.current = ticker;
    setMessages([]);
    setInput("");
    setError(null);
    setLoading(false);

    try {
      const cached = localStorage.getItem(cacheKey(ticker));
      if (cached) {
        const parsed = JSON.parse(cached);
        // Support both new format { messages: [...] } and legacy { content, suggestedPlan }
        if (parsed.messages) {
          const restored = parsed.messages.map((m, i) => i === 0 ? { ...m, fromCache: true } : m);
          setMessages(restored);
        } else if (parsed.content) {
          setMessages([{ role: "assistant", content: parsed.content, suggestedPlan: parsed.suggestedPlan ?? null, fromCache: true }]);
        }
        return;
      }
    } catch (e) {
      console.error("Cache read failed for", ticker, e);
    }

    sendMessage("Analysiere dieses Setup als Swing-Trading-Kandidat.", [], ticker);
  }, [ticker]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function handleRefresh() {
    try { localStorage.removeItem(cacheKey(ticker)); } catch (e) { console.error("Cache remove failed for", ticker, e); }
    activeTicker.current = ticker;
    setMessages([]);
    setError(null);
    sendMessage("Analysiere dieses Setup als Swing-Trading-Kandidat.", [], ticker);
  }

  async function sendMessage(text, history, forTicker) {
    const msg = (text ?? input).trim();
    if (!msg) return;

    const requestTicker = forTicker ?? ticker;
    const newHistory = history ?? messages.map(m => ({ role: m.role, content: m.content }));
    const isInitialAnalysis = Array.isArray(history) && history.length === 0;

    // Optimistically add user message (skip for initial auto-message)
    if (history === undefined) {
      setMessages(prev => [...prev, { role: "user", content: msg }]);
      setInput("");
    }

    setLoading(true);
    setError(null);

    try {
      const res = await axios.post(`/api/research/${requestTicker}/chat`, {
        message: msg,
        history: newHistory,
      });

      // Ignore response if the user switched tickers while the request was in flight
      if (activeTicker.current !== requestTicker) return;

      const { reply, suggested_plan } = res.data;
      const newMsg = { role: "assistant", content: reply, suggestedPlan: suggested_plan ?? null };
      setMessages(prev => {
        const updated = [...prev, newMsg];
        // Persist full conversation after every assistant response
        try {
          const toStore = updated.map(({ fromCache, ...m }) => m);  // strip UI-only flag
          localStorage.setItem(cacheKey(requestTicker), JSON.stringify({ messages: toStore }));
        } catch (e) {
          console.error("Cache write failed for", requestTicker, e);
        }
        return updated;
      });
    } catch (err) {
      if (activeTicker.current !== requestTicker) return;
      setError(err.response?.data?.detail || "Claude API nicht erreichbar.");
    } finally {
      if (activeTicker.current === requestTicker) {
        setLoading(false);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    }
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const isCached = messages[0]?.fromCache === true;
  const cachedCount = isCached ? messages.length : 0;

  return (
    <div className="flex flex-col h-full min-h-[420px]">
      {/* Disclaimer */}
      <div className="flex items-start gap-2 px-3 py-2 mb-3 rounded-lg bg-amber-900/10 border border-amber-700/30 text-[11px] text-amber-400/80 flex-shrink-0">
        <span className="mt-0.5">⚠️</span>
        <span>Diese KI-Analyse dient ausschließlich als Informationsquelle — keine Anlage- oder Handelsberatung. Alle Entscheidungen auf eigenes Risiko.</span>
      </div>

      {/* Cache badge */}
      {isCached && (
        <div className="flex items-center gap-2 mb-2 px-1 flex-shrink-0">
          <span className="text-[10px] text-gray-600">
            💾 Gecacht · {todayStr()} · {cachedCount} Nachricht{cachedCount !== 1 ? "en" : ""}
          </span>
          <button
            onClick={handleRefresh}
            className="text-[10px] text-indigo-400 hover:text-indigo-300 transition"
          >
            Neu analysieren
          </button>
        </div>
      )}

      {/* Message list */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 mb-3">
        {messages.length === 0 && !loading && (
          <div className="text-gray-600 text-sm text-center py-8 animate-pulse">
            Analyse wird gestartet…
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[90%] ${m.role === "user" ? "order-2" : ""}`}>
              {m.role === "assistant" && (
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="w-4 h-4 rounded-full bg-indigo-700 flex items-center justify-center text-[9px] text-white font-bold flex-shrink-0">C</div>
                  <span className="text-[10px] text-gray-500">Claude</span>
                </div>
              )}
              <div
                className={`rounded-xl px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-gray-700 text-gray-100 rounded-tr-sm"
                    : "bg-indigo-950/60 border border-indigo-800/40 text-gray-200 rounded-tl-sm"
                }`}
              >
                {m.content}
              </div>
              {m.role === "assistant" && m.suggestedPlan && (
                <button
                  onClick={() => onSuggestPlan?.(m.suggestedPlan)}
                  className="mt-1.5 flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg bg-indigo-700/30 hover:bg-indigo-700/50 border border-indigo-600/50 text-indigo-300 transition"
                >
                  Plan erstellen ↗
                </button>
              )}
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {loading && (
          <div className="flex justify-start">
            <div className="max-w-[90%]">
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-4 h-4 rounded-full bg-indigo-700 flex items-center justify-center text-[9px] text-white font-bold">C</div>
                <span className="text-[10px] text-gray-500">Claude</span>
              </div>
              <div className="bg-indigo-950/60 border border-indigo-800/40 rounded-xl rounded-tl-sm px-4 py-3 flex gap-1.5 items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-3 py-2 rounded-lg bg-red-900/20 border border-red-700/40 text-red-400 text-xs">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="flex gap-2 flex-shrink-0 border-t border-gray-800 pt-3">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Frage stellen… (Enter = Senden, Shift+Enter = Zeilenumbruch)"
          rows={2}
          disabled={loading}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition resize-none disabled:opacity-50"
        />
        <button
          onClick={() => sendMessage()}
          disabled={loading || !input.trim()}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 text-white text-sm font-semibold rounded-lg transition self-end"
        >
          {loading ? "…" : "Senden"}
        </button>
      </div>
    </div>
  );
}
