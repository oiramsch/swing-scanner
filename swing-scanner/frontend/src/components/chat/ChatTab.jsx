import { useState, useRef, useEffect } from "react";
import axios from "axios";

const QUICK_PROMPTS = [
  "Welcher der heutigen Kandidaten hat das beste Risiko-Profil?",
  "Erkläre mir das aktuelle Marktregime und was es für meine Strategie bedeutet.",
  "Welche Kandidaten haben CRV > 2.5 und hohe Confidence?",
  "Wie viele Kandidaten gibt es heute und aus welchen Modulen?",
];

function Message({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs flex-shrink-0 mt-0.5 ${
        isUser ? "bg-indigo-600 text-white" : "bg-gray-700 text-gray-300"
      }`}>
        {isUser ? "Du" : "AI"}
      </div>
      <div className={`max-w-[80%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
        isUser
          ? "bg-indigo-600/20 border border-indigo-600/30 text-indigo-100"
          : "bg-gray-800 border border-gray-700 text-gray-200"
      }`}>
        {msg.content.split("\n").map((line, i) => (
          <span key={i}>{line}{i < msg.content.split("\n").length - 1 && <br />}</span>
        ))}
        {msg.tokens_used && (
          <div className="text-[10px] text-gray-600 mt-1.5">{msg.tokens_used} tokens</div>
        )}
      </div>
    </div>
  );
}

export default function ChatTab() {
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, loading]);

  async function send(text) {
    const message = (text || input).trim();
    if (!message || loading) return;
    setInput("");
    setError(null);

    const userMsg = { role: "user", content: message };
    setHistory(h => [...h, userMsg]);
    setLoading(true);

    try {
      const res = await axios.post("/api/chat", {
        message,
        session_history: history,
      });
      setHistory(h => [...h, {
        role: "assistant",
        content: res.data.reply,
        tokens_used: res.data.tokens_used,
      }]);
    } catch (err) {
      const detail = err.response?.data?.detail || "Verbindungsfehler";
      setError(detail);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function clearChat() {
    setHistory([]);
    setError(null);
  }

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] max-w-3xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-white font-semibold text-sm">AI Chat</h2>
          <p className="text-gray-500 text-xs mt-0.5">
            Claude analysiert deine heutigen Kandidaten · Kein Anlageberatung
          </p>
        </div>
        {history.length > 0 && (
          <button
            onClick={clearChat}
            className="text-xs text-gray-600 hover:text-gray-400 transition px-2 py-1 rounded border border-gray-800 hover:border-gray-700"
          >
            Chat leeren
          </button>
        )}
      </div>

      {/* Message area */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1">

        {history.length === 0 && !loading && (
          <div className="space-y-3">
            <div className="text-center py-8">
              <div className="text-4xl mb-3">🤖</div>
              <p className="text-gray-400 text-sm">Frag mich zu den heutigen Kandidaten, dem Marktregime oder deinen offenen Plänen.</p>
              <p className="text-gray-600 text-xs mt-1">Session-History wird nicht gespeichert — wird bei Seitenwechsel gelöscht.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {QUICK_PROMPTS.map((q, i) => (
                <button
                  key={i}
                  onClick={() => send(q)}
                  className="text-left px-3 py-2.5 rounded-lg border border-gray-800 bg-gray-900 hover:border-indigo-700/50 hover:bg-indigo-900/10 text-xs text-gray-400 hover:text-gray-200 transition"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {history.map((msg, i) => (
          <Message key={i} msg={msg} />
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-xs text-gray-300 flex-shrink-0 mt-0.5">AI</div>
            <div className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3">
              <div className="flex gap-1 items-center">
                {[0, 1, 2].map(i => (
                  <span key={i} className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
                ))}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="px-4 py-3 rounded-xl bg-red-900/20 border border-red-700/40 text-red-400 text-xs">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="mt-4 flex gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Frag mich zu Kandidaten, Regime, Setups… (Enter = senden)"
          rows={2}
          className="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-none"
        />
        <button
          onClick={() => send()}
          disabled={loading || !input.trim()}
          className="px-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-xl font-semibold text-sm transition flex items-center justify-center min-w-[60px]"
        >
          {loading ? (
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : "→"}
        </button>
      </div>

    </div>
  );
}
