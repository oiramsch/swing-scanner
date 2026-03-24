import { useState, useEffect, Component } from "react";
import axios from "axios";

class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div className="bg-red-900/20 border border-red-700/50 rounded-xl p-4 text-sm text-red-300">
          <div className="font-semibold mb-1">Render-Fehler in Einstellungen</div>
          <pre className="text-xs text-red-400 whitespace-pre-wrap">{String(this.state.error)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function Section({ title, children }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
      <h2 className="text-sm font-semibold text-gray-200">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-gray-600 mt-1">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Broker Connection
// ---------------------------------------------------------------------------
function BrokerSection({ currentUser }) {
  const [broker, setBroker] = useState(null);
  const [form, setForm] = useState({ api_key: "", api_secret: "", is_paper: true });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { loadBroker(); }, []);

  async function loadBroker() {
    try {
      const res = await axios.get("/api/settings/broker");
      setBroker(res.data);
      setForm(f => ({ ...f, is_paper: res.data.is_paper ?? true }));
    } catch {}
  }

  async function saveBroker(e) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      await axios.put("/api/settings/broker", {
        ...form,
        // Don't send empty strings — server interprets as "no change"
        api_key:    form.api_key    || undefined,
        api_secret: form.api_secret || undefined,
      });
      setSaved(true);
      setForm(f => ({ ...f, api_key: "", api_secret: "" }));
      loadBroker();
    } catch (err) {
      alert(err.response?.data?.detail || "Fehler beim Speichern");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await axios.post("/api/settings/broker/test");
      setTestResult({ ok: true, ...res.data });
    } catch (err) {
      setTestResult({ ok: false, error: err.response?.data?.detail || "Fehler" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Section title="Broker-Verbindung (Alpaca)">
      {broker && (
        <div className="flex items-center gap-2 text-xs flex-wrap">
          <span className={`px-2 py-0.5 rounded-full border text-[11px] font-medium ${
            broker.is_paper
              ? "text-yellow-400 border-yellow-800/50 bg-yellow-900/20"
              : "text-green-400 border-green-800/50 bg-green-900/20"
          }`}>
            {broker.is_paper ? "PAPER TRADING" : "LIVE TRADING"}
          </span>
          <span className="text-gray-500">
            API Key: {broker.api_key_set ? "✓ gesetzt" : "⚠ nicht gesetzt"}
          </span>
          <span className="text-gray-500">
            Secret: {broker.api_secret_set ? "✓ gesetzt" : "⚠ nicht gesetzt"}
          </span>
          <span className="text-gray-600 text-[11px]">
            Quelle: {broker.source === "db" ? "Datenbank" : ".env-Datei"}
          </span>
        </div>
      )}

      <form onSubmit={saveBroker} className="space-y-3">
        <Field label="API Key" hint="Leer lassen um bestehenden Key zu behalten">
          <input
            type="password"
            value={form.api_key}
            onChange={e => setForm(f => ({ ...f, api_key: e.target.value }))}
            placeholder="PKXXXXX… (leer = unverändert)"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
          />
        </Field>

        <Field label="API Secret" hint="Leer lassen um bestehenden Secret zu behalten">
          <input
            type="password"
            value={form.api_secret}
            onChange={e => setForm(f => ({ ...f, api_secret: e.target.value }))}
            placeholder="XXXXXXX… (leer = unverändert)"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
          />
        </Field>

        <Field label="Modus">
          <div className="flex gap-3">
            {[
              { value: true,  label: "Paper Trading",  color: "text-yellow-400" },
              { value: false, label: "Live Trading",   color: "text-red-400" },
            ].map(opt => (
              <label key={String(opt.value)} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="is_paper"
                  checked={form.is_paper === opt.value}
                  onChange={() => setForm(f => ({ ...f, is_paper: opt.value }))}
                  className="accent-indigo-500"
                />
                <span className={`text-sm ${opt.color}`}>{opt.label}</span>
              </label>
            ))}
          </div>
        </Field>

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition disabled:opacity-50"
          >
            {saving ? "Speichern…" : saved ? "✓ Gespeichert" : "Speichern"}
          </button>
          <button
            type="button"
            onClick={testConnection}
            disabled={testing}
            className="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg border border-gray-700 transition disabled:opacity-50"
          >
            {testing ? "Teste…" : "Verbindung testen"}
          </button>
        </div>
      </form>

      {testResult && (
        <div className={`text-sm p-3 rounded-lg border ${
          testResult.ok
            ? "bg-green-900/20 border-green-800/40 text-green-300"
            : "bg-red-900/20 border-red-800/40 text-red-300"
        }`}>
          {testResult.ok ? (
            <>
              ✓ Verbindung OK · Status: {testResult.account_status} ·
              Kaufkraft: ${parseFloat(testResult.buying_power).toFixed(2)} {testResult.currency}
              {testResult.is_paper && <span className="ml-2 text-yellow-400 text-xs">(Paper)</span>}
            </>
          ) : (
            <>✕ {testResult.error}</>
          )}
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Change Password
// ---------------------------------------------------------------------------
function PasswordSection({ currentUser, onLogout }) {
  const [form, setForm] = useState({ current_password: "", new_password: "", confirm: "" });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (form.new_password !== form.confirm) {
      setMessage({ ok: false, text: "Neues Passwort stimmt nicht überein" });
      return;
    }
    if (form.new_password.length < 8) {
      setMessage({ ok: false, text: "Passwort muss mindestens 8 Zeichen haben" });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await axios.post("/api/auth/change-password", {
        current_password: form.current_password,
        new_password: form.new_password,
      });
      setMessage({ ok: true, text: "Passwort geändert. Bitte neu anmelden." });
      setForm({ current_password: "", new_password: "", confirm: "" });
      setTimeout(onLogout, 2000);
    } catch (err) {
      setMessage({ ok: false, text: err.response?.data?.detail || "Fehler" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Passwort ändern">
      <form onSubmit={handleSubmit} className="space-y-3">
        <Field label="Aktuelles Passwort">
          <input
            type="password"
            value={form.current_password}
            onChange={e => setForm(f => ({ ...f, current_password: e.target.value }))}
            required
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
          />
        </Field>
        <Field label="Neues Passwort" hint="Mindestens 8 Zeichen">
          <input
            type="password"
            value={form.new_password}
            onChange={e => setForm(f => ({ ...f, new_password: e.target.value }))}
            required
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
          />
        </Field>
        <Field label="Neues Passwort bestätigen">
          <input
            type="password"
            value={form.confirm}
            onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
            required
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
          />
        </Field>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition disabled:opacity-50"
        >
          {saving ? "Speichern…" : "Passwort ändern"}
        </button>
        {message && (
          <p className={`text-sm ${message.ok ? "text-green-400" : "text-red-400"}`}>
            {message.text}
          </p>
        )}
      </form>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Strategy Modules
// ---------------------------------------------------------------------------
const REGIME_BADGE = {
  bull:    "text-green-400 bg-green-900/20 border-green-800/50",
  bear:    "text-orange-400 bg-orange-900/20 border-orange-800/50",
  neutral: "text-yellow-400 bg-yellow-900/20 border-yellow-800/50",
  any:     "text-gray-400 bg-gray-800/50 border-gray-700",
};

function ModulesSection() {
  const [modules, setModules] = useState([]);
  const [toggling, setToggling] = useState(null);

  useEffect(() => { loadModules(); }, []);

  async function loadModules() {
    try {
      const res = await axios.get("/api/strategy-modules");
      setModules(res.data.modules ?? res.data);
    } catch {}
  }

  async function toggleModule(id) {
    setToggling(id);
    try {
      await axios.post(`/api/strategy-modules/${id}/toggle`);
      await loadModules();
    } catch {}
    setToggling(null);
  }

  return (
    <Section title="Strategie-Module">
      <div className="space-y-2">
        {modules.map(m => (
          <div key={m.id} className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700/50">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-white font-medium">{m.name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${REGIME_BADGE[m.regime] ?? REGIME_BADGE.any}`}>
                  {m.regime.toUpperCase()}
                </span>
                <span className="text-[10px] text-gray-600">{m.direction}</span>
              </div>
              {m.description && (
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{m.description}</p>
              )}
            </div>
            <button
              onClick={() => toggleModule(m.id)}
              disabled={toggling === m.id}
              className={`shrink-0 px-3 py-1.5 text-xs rounded-lg border transition disabled:opacity-50 font-medium ${
                m.is_active
                  ? "bg-green-900/30 border-green-700/50 text-green-400 hover:bg-red-900/20 hover:border-red-700/40 hover:text-red-400"
                  : "bg-gray-800 border-gray-700 text-gray-500 hover:bg-green-900/20 hover:border-green-700/40 hover:text-green-400"
              }`}
            >
              {toggling === m.id ? "…" : m.is_active ? "✓ Aktiv" : "Inaktiv"}
            </button>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gray-600">
        Aktive Module werden beim nächsten Scan für das passende Markt-Regime verwendet.
      </p>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Scanner Config (read-only)
// ---------------------------------------------------------------------------
function ScannerSection() {
  const [cfg, setCfg] = useState(null);

  useEffect(() => {
    axios.get("/api/settings/scanner").then(r => setCfg(r.data)).catch(() => {});
  }, []);

  if (!cfg) return null;

  return (
    <Section title="Scanner-Konfiguration">
      <div className="grid grid-cols-2 gap-2 text-xs">
        {[
          ["Datenprovider",  cfg.data_provider],
          ["Universum",      cfg.stock_universe],
          ["Min. Preis",     `$${cfg.min_price}`],
          ["Min. Volumen",   cfg.min_volume?.toLocaleString()],
          ["Max. Kandidaten", cfg.max_candidates],
          ["Scan-Zeit (UTC)", cfg.scan_time_utc],
        ].map(([label, value]) => (
          <div key={label} className="bg-gray-800/50 rounded p-2">
            <div className="text-gray-500 text-[10px]">{label}</div>
            <div className="text-gray-200 font-medium mt-0.5">{value}</div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gray-600">
        Konfiguration über <code className="text-gray-500">.env</code> ändern + Container neu starten.
      </p>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function SettingsTab({ currentUser, onLogout }) {
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-lg font-semibold text-white">Einstellungen</h1>
          <p className="text-xs text-gray-500 mt-0.5">Angemeldet als {currentUser?.email}</p>
        </div>
        <button
          onClick={onLogout}
          className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded-lg border border-gray-700 transition"
        >
          Abmelden
        </button>
      </div>

      <ErrorBoundary><BrokerSection currentUser={currentUser} /></ErrorBoundary>
      <ErrorBoundary><ModulesSection /></ErrorBoundary>
      <ErrorBoundary><ScannerSection /></ErrorBoundary>
      <ErrorBoundary><PasswordSection currentUser={currentUser} onLogout={onLogout} /></ErrorBoundary>
    </div>
  );
}
