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
// Broker Management
// ---------------------------------------------------------------------------
const BROKER_ICONS  = { alpaca: "🦙", trade_republic: "🇩🇪", ibkr: "📊", scalable: "📈", zero: "0️⃣" };
const BROKER_LABELS = { alpaca: "Alpaca", trade_republic: "Trade Republic", ibkr: "IBKR", scalable: "Scalable Capital", zero: "Zero" };

function parseFeeModel(json) {
  try { return json ? JSON.parse(json) : { type: "flat", amount: 0 }; }
  catch { return { type: "flat", amount: 0 }; }
}

function FeeModelField({ value, onChange, currency = "USD" }) {
  const model = parseFeeModel(value);
  const sym = currency === "EUR" ? "€" : "$";

  function update(patch) {
    onChange(JSON.stringify({ ...model, ...patch }));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <label className="text-[10px] text-gray-500">Typ</label>
        <select
          value={model.type}
          onChange={e => update({ type: e.target.value })}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none"
        >
          <option value="flat">Flat Fee</option>
          <option value="percent">Prozentual</option>
        </select>
      </div>
      {model.type === "flat" && (
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-gray-500 w-16">Betrag</label>
          <input
            type="number" step="0.01" min="0"
            value={model.amount ?? 0}
            onChange={e => update({ amount: parseFloat(e.target.value) || 0 })}
            className="w-24 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none"
          />
          <span className="text-xs text-gray-500">{sym} / Order</span>
        </div>
      )}
      {model.type === "percent" && (
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-[10px] text-gray-500 w-16">Rate</label>
          <input type="number" step="0.01" min="0" value={model.rate ?? 0.1}
            onChange={e => update({ rate: parseFloat(e.target.value) || 0 })}
            className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none" />
          <span className="text-xs text-gray-500">%</span>
          <label className="text-[10px] text-gray-500 ml-2">Min</label>
          <input type="number" step="0.01" min="0" value={model.min ?? 0}
            onChange={e => update({ min: parseFloat(e.target.value) || 0 })}
            className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none" />
          <label className="text-[10px] text-gray-500 ml-2">Max</label>
          <input type="number" step="0.01" min="0" value={model.max ?? ""}
            onChange={e => update({ max: parseFloat(e.target.value) || undefined })}
            placeholder="∞"
            className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none" />
          <span className="text-xs text-gray-500">{sym}</span>
        </div>
      )}
    </div>
  );
}

function AlpacaForm({ broker, onSaved }) {
  const isNew = !broker;
  const [form, setForm] = useState({
    label: broker?.label ?? "Alpaca",
    api_key: "", api_secret: "",
    is_paper: broker?.is_paper ?? true,
    fee_model_json: broker?.fee_model_json ?? JSON.stringify({ type: "flat", amount: 0 }),
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saved, setSaved] = useState(false);

  async function save(e) {
    e.preventDefault();
    setSaving(true); setSaved(false);
    try {
      const payload = { broker_type: "alpaca", ...form, api_key: form.api_key || undefined, api_secret: form.api_secret || undefined, fee_model_json: form.fee_model_json };
      if (isNew) await axios.post("/api/brokers", payload);
      else       await axios.put(`/api/brokers/${broker.id}`, payload);
      setSaved(true);
      setForm(f => ({ ...f, api_key: "", api_secret: "" }));
      onSaved();
    } catch (err) { alert(err.response?.data?.detail || "Fehler"); }
    finally { setSaving(false); }
  }

  async function test() {
    setTesting(true); setTestResult(null);
    try {
      const res = await axios.post(`/api/brokers/${broker.id}/test`);
      setTestResult({ ok: true, ...res.data });
    } catch (err) { setTestResult({ ok: false, error: err.response?.data?.detail || "Fehler" }); }
    finally { setTesting(false); }
  }

  return (
    <form onSubmit={save} className="space-y-3 mt-3">
      <Field label="Label">
        <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500" />
      </Field>
      <Field label="API Key" hint="Leer lassen um bestehenden Key zu behalten">
        <input type="password" value={form.api_key} onChange={e => setForm(f => ({ ...f, api_key: e.target.value }))}
          placeholder="PKXXXXX… (leer = unverändert)"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500" />
      </Field>
      <Field label="API Secret" hint="Leer lassen um bestehenden Secret zu behalten">
        <input type="password" value={form.api_secret} onChange={e => setForm(f => ({ ...f, api_secret: e.target.value }))}
          placeholder="XXXXXXX… (leer = unverändert)"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500" />
      </Field>
      <Field label="Modus">
        <div className="flex gap-3">
          {[{ value: true, label: "Paper Trading", color: "text-yellow-400" }, { value: false, label: "Live Trading", color: "text-red-400" }].map(opt => (
            <label key={String(opt.value)} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name={`alpaca_paper_${broker?.id}`} checked={form.is_paper === opt.value}
                onChange={() => setForm(f => ({ ...f, is_paper: opt.value }))} className="accent-indigo-500" />
              <span className={`text-sm ${opt.color}`}>{opt.label}</span>
            </label>
          ))}
        </div>
      </Field>
      {!isNew && (broker?.api_key_set || broker?.source) && (
        <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
          <span>Key: {broker.api_key_set ? "✓ gesetzt" : "⚠ nicht gesetzt"}</span>
          <span>Secret: {broker.api_secret_set ? "✓ gesetzt" : "⚠ nicht gesetzt"}</span>
          {broker.source && <span className="text-gray-600">Quelle: {broker.source === "db" ? "DB" : ".env"}</span>}
        </div>
      )}
      <Field label="Gebühr pro Order" hint="Wird für Netto-CRV und Positionsgrößen-Berechnung verwendet">
        <FeeModelField
          value={form.fee_model_json}
          onChange={v => setForm(f => ({ ...f, fee_model_json: v }))}
          currency="USD"
        />
      </Field>
      <div className="flex gap-2">
        <button type="submit" disabled={saving}
          className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition disabled:opacity-50">
          {saving ? "Speichern…" : saved ? "✓ Gespeichert" : "Speichern"}
        </button>
        {!isNew && (
          <button type="button" onClick={test} disabled={testing}
            className="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg border border-gray-700 transition disabled:opacity-50">
            {testing ? "Teste…" : "Verbindung testen"}
          </button>
        )}
      </div>
      {testResult && (
        <div className={`text-sm p-3 rounded-lg border ${testResult.ok ? "bg-green-900/20 border-green-800/40 text-green-300" : "bg-red-900/20 border-red-800/40 text-red-300"}`}>
          {testResult.ok
            ? <>✓ Verbindung OK · {testResult.account_status} · ${parseFloat(testResult.buying_power).toFixed(2)} {testResult.currency}{testResult.is_paper && <span className="ml-2 text-yellow-400 text-xs">(Paper)</span>}</>
            : <>✕ {testResult.error}</>}
        </div>
      )}
    </form>
  );
}

function TRForm({ broker, onSaved }) {
  const isNew = !broker;
  const [form, setForm] = useState({
    label: broker?.label ?? "Trade Republic",
    manual_balance: broker?.balance?.buying_power ?? "",
    manual_currency: broker?.balance?.currency ?? "EUR",
    fee_model_json: broker?.fee_model_json ?? JSON.stringify({ type: "flat", amount: 1.0 }),
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(e) {
    e.preventDefault();
    setSaving(true); setSaved(false);
    try {
      const payload = {
        broker_type: "trade_republic",
        label: form.label,
        is_paper: false,
        manual_balance: form.manual_balance !== "" ? parseFloat(form.manual_balance) : null,
        manual_currency: form.manual_currency,
        fee_model_json: form.fee_model_json,
      };
      if (isNew) await axios.post("/api/brokers", payload);
      else       await axios.put(`/api/brokers/${broker.id}`, payload);
      setSaved(true);
      onSaved();
    } catch (err) { alert(err.response?.data?.detail || "Fehler"); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={save} className="space-y-3 mt-3">
      <Field label="Label">
        <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500" />
      </Field>
      <div className="flex gap-3">
        <Field label="Konto-Balance">
          <input type="number" step="0.01" value={form.manual_balance}
            onChange={e => setForm(f => ({ ...f, manual_balance: e.target.value }))}
            placeholder="z.B. 1000.00"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500" />
        </Field>
        <Field label="Währung">
          <select value={form.manual_currency} onChange={e => setForm(f => ({ ...f, manual_currency: e.target.value }))}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500">
            <option value="EUR">EUR €</option>
            <option value="USD">USD $</option>
          </select>
        </Field>
      </div>
      <p className="text-[11px] text-gray-600">Balance wird manuell gepflegt und im Deal Cockpit als Kaufkraft angezeigt.</p>
      <Field label="Gebühr pro Order" hint="Trade Republic: €1 Flat Fee (Standard)">
        <FeeModelField
          value={form.fee_model_json}
          onChange={v => setForm(f => ({ ...f, fee_model_json: v }))}
          currency="EUR"
        />
      </Field>
      <button type="submit" disabled={saving}
        className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition disabled:opacity-50">
        {saving ? "Speichern…" : saved ? "✓ Gespeichert" : "Speichern"}
      </button>
    </form>
  );
}

function ManualBrokerForm({ broker, brokerType, onSaved }) {
  const isNew = !broker;
  const defaultFees = { scalable: JSON.stringify({ type: "flat", amount: 0.99 }), zero: JSON.stringify({ type: "flat", amount: 0.0 }) };
  const defaultLabels = { scalable: "Scalable Capital", zero: "Zero" };
  const [form, setForm] = useState({
    label: broker?.label ?? defaultLabels[brokerType] ?? brokerType,
    manual_balance: broker?.balance?.buying_power ?? "",
    fee_model_json: broker?.fee_model_json ?? defaultFees[brokerType] ?? JSON.stringify({ type: "flat", amount: 0.0 }),
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(e) {
    e.preventDefault();
    setSaving(true); setSaved(false);
    try {
      const payload = {
        broker_type: brokerType,
        label: form.label,
        is_paper: false,
        manual_balance: form.manual_balance !== "" ? parseFloat(form.manual_balance) : null,
        manual_currency: "EUR",
        fee_model_json: form.fee_model_json,
      };
      if (isNew) await axios.post("/api/brokers", payload);
      else       await axios.put(`/api/brokers/${broker.id}`, payload);
      setSaved(true);
      onSaved();
    } catch (err) { alert(err.response?.data?.detail || "Fehler"); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={save} className="space-y-3 mt-3">
      <Field label="Label">
        <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500" />
      </Field>
      <Field label="Konto-Balance (EUR)">
        <input type="number" step="0.01" value={form.manual_balance}
          onChange={e => setForm(f => ({ ...f, manual_balance: e.target.value }))}
          placeholder="z.B. 1000.00"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500" />
      </Field>
      <p className="text-[11px] text-gray-600">Manueller Broker — Orders werden als Checkliste angezeigt. Balance manuell pflegen.</p>
      <Field label="Gebühr pro Order">
        <FeeModelField
          value={form.fee_model_json}
          onChange={v => setForm(f => ({ ...f, fee_model_json: v }))}
          currency="EUR"
        />
      </Field>
      <button type="submit" disabled={saving}
        className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition disabled:opacity-50">
        {saving ? "Speichern…" : saved ? "✓ Gespeichert" : "Speichern"}
      </button>
    </form>
  );
}

function BrokerCard({ broker, onSaved, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const sym = broker.balance?.currency === "EUR" ? "€" : "$";
  const val = broker.balance?.buying_power;

  async function handleDelete() {
    if (!confirm(`Broker "${broker.label}" wirklich löschen?`)) return;
    setDeleting(true);
    try {
      await axios.delete(`/api/brokers/${broker.id}`);
      onDelete();
    } catch (err) { alert(err.response?.data?.detail || "Fehler"); }
    finally { setDeleting(false); }
  }

  return (
    <div className="border border-gray-700/50 rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-800/40 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <span className="text-lg">{BROKER_ICONS[broker.broker_type] ?? "💼"}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white text-sm font-medium">{broker.label}</span>
            {broker.is_paper && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-900/30 border border-yellow-800/50 text-yellow-400">PAPER</span>}
            <span className="text-[10px] text-gray-600">{BROKER_LABELS[broker.broker_type] ?? broker.broker_type}</span>
          </div>
          {val != null && <div className="text-xs text-gray-500 mt-0.5">Kaufkraft: {sym}{parseFloat(val).toLocaleString("de", { maximumFractionDigits: 0 })}</div>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={e => { e.stopPropagation(); handleDelete(); }} disabled={deleting}
            className="text-[11px] text-gray-600 hover:text-red-400 transition px-2 py-1 disabled:opacity-50">
            {deleting ? "…" : "Löschen"}
          </button>
          <span className="text-gray-600 text-xs">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-4 bg-gray-800/20">
          {broker.broker_type === "alpaca"          && <AlpacaForm broker={broker} onSaved={onSaved} />}
          {broker.broker_type === "trade_republic"  && <TRForm     broker={broker} onSaved={onSaved} />}
          {["scalable", "zero"].includes(broker.broker_type) && (
            <ManualBrokerForm broker={broker} brokerType={broker.broker_type} onSaved={onSaved} />
          )}
          {!["alpaca", "trade_republic", "scalable", "zero"].includes(broker.broker_type) && (
            <p className="text-xs text-gray-500 mt-3">Kein Editor für diesen Broker-Typ.</p>
          )}
        </div>
      )}
    </div>
  );
}

function BrokerManagementSection() {
  const [brokers, setBrokers] = useState([]);
  const [adding, setAdding] = useState(null); // "alpaca" | "trade_republic" | null

  useEffect(() => { loadBrokers(); }, []);

  async function loadBrokers() {
    try {
      const res = await axios.get("/api/brokers");
      setBrokers(res.data || []);
    } catch {}
  }

  return (
    <Section title="Broker-Verwaltung">
      <div className="space-y-2">
        {brokers.length === 0 && (
          <p className="text-xs text-gray-500">Keine Broker konfiguriert.</p>
        )}
        {brokers.map(b => (
          <BrokerCard key={b.id} broker={b} onSaved={loadBrokers} onDelete={loadBrokers} />
        ))}
      </div>

      {/* Add new broker */}
      {adding ? (
        <div className="border border-indigo-700/40 rounded-lg p-4 bg-indigo-900/10 mt-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-indigo-300">
              {BROKER_ICONS[adding]} Neuer {BROKER_LABELS[adding]} Broker
            </span>
            <button onClick={() => setAdding(null)} className="text-gray-500 hover:text-gray-300 text-sm">✕</button>
          </div>
          {adding === "alpaca"         && <AlpacaForm onSaved={() => { setAdding(null); loadBrokers(); }} />}
          {adding === "trade_republic" && <TRForm     onSaved={() => { setAdding(null); loadBrokers(); }} />}
          {["scalable", "zero"].includes(adding) && (
            <ManualBrokerForm brokerType={adding} onSaved={() => { setAdding(null); loadBrokers(); }} />
          )}
        </div>
      ) : (
        <div className="flex gap-2 mt-2 flex-wrap">
          <span className="text-xs text-gray-600 self-center">+ Broker hinzufügen:</span>
          {[
            { type: "alpaca",         label: "🦙 Alpaca" },
            { type: "trade_republic", label: "🇩🇪 Trade Republic" },
            { type: "scalable",       label: "📈 Scalable Capital" },
            { type: "zero",           label: "0️⃣ Zero" },
          ].map(opt => (
            <button key={opt.type} onClick={() => setAdding(opt.type)}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-300 transition">
              {opt.label}
            </button>
          ))}
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

function ModuleEditor({ module: m, onSaved, onClose }) {
  const [form, setForm] = useState({
    price_min:        m.price_min ?? 10,
    price_max:        m.price_max ?? 500,
    avg_volume_min:   m.avg_volume_min ?? 500000,
    rsi_min:          m.rsi_min ?? 35,
    rsi_max:          m.rsi_max ?? 75,
    confidence_min:   m.confidence_min ?? 6,
    volume_multiplier: m.volume_multiplier ?? 1.0,
  });
  const [saving, setSaving] = useState(false);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await axios.put(`/api/strategy-modules/${m.id}`, form);
      onSaved();
      onClose();
    } catch (err) { alert(err.response?.data?.detail || "Fehler"); }
    finally { setSaving(false); }
  }

  const inp = "w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-xs focus:outline-none focus:border-indigo-500";

  return (
    <form onSubmit={save} className="mt-3 p-3 bg-gray-800/60 rounded-lg border border-gray-700/50 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Preis Min ($)"><input type="number" step="1" className={inp} value={form.price_min} onChange={e => setForm(f => ({ ...f, price_min: +e.target.value }))} /></Field>
        <Field label="Preis Max ($)"><input type="number" step="1" className={inp} value={form.price_max} onChange={e => setForm(f => ({ ...f, price_max: +e.target.value }))} /></Field>
        <Field label="Min. Volumen"><input type="number" step="50000" className={inp} value={form.avg_volume_min} onChange={e => setForm(f => ({ ...f, avg_volume_min: +e.target.value }))} /></Field>
        <Field label="Vol. Multiplikator"><input type="number" step="0.1" min="0" className={inp} value={form.volume_multiplier} onChange={e => setForm(f => ({ ...f, volume_multiplier: +e.target.value }))} /></Field>
        <Field label="RSI Min"><input type="number" step="1" min="0" max="100" className={inp} value={form.rsi_min} onChange={e => setForm(f => ({ ...f, rsi_min: +e.target.value }))} /></Field>
        <Field label="RSI Max"><input type="number" step="1" min="0" max="100" className={inp} value={form.rsi_max} onChange={e => setForm(f => ({ ...f, rsi_max: +e.target.value }))} /></Field>
        <Field label="Min. Confidence"><input type="number" step="1" min="1" max="10" className={inp} value={form.confidence_min} onChange={e => setForm(f => ({ ...f, confidence_min: +e.target.value }))} /></Field>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-3 py-1.5 text-xs bg-indigo-700 hover:bg-indigo-600 text-white rounded-lg disabled:opacity-50">
          {saving ? "…" : "Speichern"}
        </button>
        <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg">
          Abbrechen
        </button>
      </div>
    </form>
  );
}

function ModulesSection() {
  const [modules,       setModules]       = useState([]);
  const [currentRegime, setCurrentRegime] = useState(null);
  const [activeIds,     setActiveIds]     = useState(new Set());
  const [toggling,      setToggling]      = useState(null);
  const [editing,       setEditing]       = useState(null); // module id

  useEffect(() => { loadModules(); }, []);

  async function loadModules() {
    try {
      const res  = await axios.get("/api/strategy-modules");
      const data = res.data;
      const mods = Array.isArray(data) ? data : Array.isArray(data?.modules) ? data.modules : [];
      setModules(mods);
      setCurrentRegime(data?.current_regime ?? null);
      setActiveIds(new Set((data?.active_for_regime ?? []).map(m => m.id)));
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
      {currentRegime && (
        <div className="flex items-center gap-2 text-xs text-gray-400 -mt-1 mb-1">
          <span>Aktuelles Regime:</span>
          <span className={`px-2 py-0.5 rounded-full border font-semibold ${REGIME_BADGE[currentRegime] ?? REGIME_BADGE.any}`}>
            {currentRegime.toUpperCase()}
          </span>
          <span className="text-gray-600">→ nur passende Module laufen beim Scan</span>
        </div>
      )}
      <div className="space-y-2">
        {modules.map(m => {
          const runningNow = activeIds.has(m.id);
          return (
            <div key={m.id} className={`rounded-lg border ${runningNow ? "bg-indigo-900/10 border-indigo-700/40" : "bg-gray-800/50 border-gray-700/50"}`}>
              <div className="flex items-center gap-3 p-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-white font-medium">{m.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${REGIME_BADGE[m.regime] ?? REGIME_BADGE.any}`}>
                      {m.regime.toUpperCase()}
                    </span>
                    {runningNow && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/40 border border-indigo-600/50 text-indigo-300 font-semibold">
                        ▶ Läuft jetzt
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-600 mt-0.5">
                    Preis ${m.price_min}–${m.price_max} · Vol {(m.avg_volume_min/1000).toFixed(0)}k · RSI {m.rsi_min}–{m.rsi_max} · Conf ≥{m.confidence_min}
                  </p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    onClick={() => setEditing(editing === m.id ? null : m.id)}
                    className="px-2.5 py-1.5 text-xs rounded-lg border border-gray-600 bg-gray-800 hover:bg-gray-700 text-gray-400 transition"
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => toggleModule(m.id)}
                    disabled={toggling === m.id}
                    className={`shrink-0 px-3 py-1.5 text-xs rounded-lg border transition disabled:opacity-50 font-medium ${
                      m.is_active
                        ? "bg-green-900/30 border-green-700/50 text-green-400 hover:bg-red-900/20 hover:border-red-700/40 hover:text-red-400"
                        : "bg-gray-800 border-gray-700 text-gray-500 hover:bg-green-900/20 hover:border-green-700/40 hover:text-green-400"
                    }`}
                  >
                    {toggling === m.id ? "…" : m.is_active ? "✓ Aktiv" : "Deaktiviert"}
                  </button>
                </div>
              </div>
              {editing === m.id && (
                <ModuleEditor module={m} onSaved={loadModules} onClose={() => setEditing(null)} />
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-gray-600">
        "Aktiv" = verfügbar. "Läuft jetzt" = wird beim nächsten Scan verwendet (Regime passt). ✎ = Filter-Parameter bearbeiten.
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
// Push-Notifications (ntfy.sh)
// ---------------------------------------------------------------------------
function NtfySection() {
  const [cfg,     setCfg]     = useState(null);
  const [topic,   setTopic]   = useState("");
  const [alerts,  setAlerts]  = useState({ alerts_scan: true, alerts_entry_zone: true, alerts_regime: true });
  const [saving,  setSaving]  = useState(false);
  const [testing, setTesting] = useState(false);
  const [result,  setResult]  = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const res = await axios.get("/api/settings/ntfy");
      setCfg(res.data);
      setAlerts({
        alerts_scan:       res.data.alerts_scan       ?? true,
        alerts_entry_zone: res.data.alerts_entry_zone ?? true,
        alerts_regime:     res.data.alerts_regime     ?? true,
      });
    } catch {}
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true); setResult(null);
    try {
      await axios.put("/api/settings/ntfy", { topic: topic || undefined, ...alerts });
      setResult({ ok: true, text: "Gespeichert." });
      setTopic("");
      await load();
    } catch (err) {
      setResult({ ok: false, text: err.response?.data?.detail || "Fehler" });
    } finally { setSaving(false); }
  }

  async function test() {
    setTesting(true); setResult(null);
    try {
      await axios.post("/api/settings/ntfy/test");
      setResult({ ok: true, text: "Test-Nachricht gesendet — Handy checken!" });
    } catch (err) {
      setResult({ ok: false, text: err.response?.data?.detail || "Fehler" });
    } finally { setTesting(false); }
  }

  const CHECKS = [
    { key: "alerts_scan",       label: "Tägliches Scan-Ergebnis" },
    { key: "alerts_entry_zone", label: "Kaufzonen-Alerts (stündlich während Marktzeiten)" },
    { key: "alerts_regime",     label: "Regime-Wechsel" },
  ];

  return (
    <Section title="Push-Notifications (ntfy.sh)">
      {cfg && cfg.topic_set && (
        <div className="flex items-center gap-1.5 text-xs text-green-400">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
          Topic: <span className="font-mono">{cfg.topic}</span>
        </div>
      )}
      {cfg && !cfg.topic_set && (
        <div className="text-xs text-gray-500">
          Kein Topic konfiguriert — Push-Notifications deaktiviert.{" "}
          <a href="https://ntfy.sh" target="_blank" rel="noreferrer" className="text-indigo-400 underline">ntfy.sh</a> ist kostenlos, kein Account nötig.
        </div>
      )}

      <form onSubmit={save} className="space-y-3 mt-1">
        <Field label="ntfy.sh Topic" hint="z.B. swing-scanner-mario — muss eindeutig sein (kein Account nötig)">
          <input
            type="text"
            value={topic}
            onChange={e => setTopic(e.target.value)}
            placeholder={cfg?.topic || "swing-scanner-deinname"}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
          />
        </Field>

        <div className="space-y-2">
          <label className="block text-xs text-gray-400">Aktive Alerts</label>
          {CHECKS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={alerts[key]}
                onChange={e => setAlerts(a => ({ ...a, [key]: e.target.checked }))}
                className="accent-indigo-500"
              />
              <span className="text-sm text-gray-300">{label}</span>
            </label>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={test}
            disabled={testing || !cfg?.topic_set}
            title={!cfg?.topic_set ? "Erst Topic speichern" : undefined}
            className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-lg transition disabled:opacity-50"
          >
            {testing ? "Sende…" : "Test-Notification senden"}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-3 py-1.5 text-xs bg-indigo-700 hover:bg-indigo-600 text-white rounded-lg transition disabled:opacity-50"
          >
            {saving ? "Speichern…" : "Speichern"}
          </button>
        </div>
        {result && (
          <p className={`text-xs ${result.ok ? "text-green-400" : "text-red-400"}`}>{result.text}</p>
        )}
      </form>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Claude API Key & Health
// ---------------------------------------------------------------------------
function ClaudeApiSection() {
  const [health,   setHealth]   = useState(null);
  const [apiKey,   setApiKey]   = useState("");
  const [saving,   setSaving]   = useState(false);
  const [testing,  setTesting]  = useState(false);
  const [result,   setResult]   = useState(null); // { ok, text }

  useEffect(() => { loadHealth(); }, []);

  async function loadHealth() {
    try {
      const res = await axios.get("/api/health/ai");
      setHealth(res.data);
    } catch {}
  }

  async function save(e) {
    e.preventDefault();
    if (!apiKey) return;
    setSaving(true); setResult(null);
    try {
      await axios.put("/api/settings/anthropic-key", { api_key: apiKey });
      setResult({ ok: true, text: "Key gespeichert. Scanner nutzt ihn ab sofort." });
      setApiKey("");
      await loadHealth();
    } catch (err) {
      setResult({ ok: false, text: err.response?.data?.detail || "Fehler beim Speichern" });
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true); setResult(null);
    try {
      const res = await axios.post("/api/settings/anthropic-key/test", { api_key: apiKey || undefined });
      if (res.data.ok) {
        setResult({ ok: true, text: "Verbindung erfolgreich — Key ist gültig." });
        await loadHealth();
      } else {
        setResult({ ok: false, text: res.data.error || "Test fehlgeschlagen" });
      }
    } catch (err) {
      setResult({ ok: false, text: err.response?.data?.detail || "Test fehlgeschlagen" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Section title="Claude API Key">
      {/* Status banner */}
      {health && !health.ok && (
        <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3 text-xs text-red-300">
          <div className="font-semibold mb-0.5">Claude API — Fehler zuletzt aufgetreten</div>
          <div className="text-red-400/80">{health.error}</div>
          {health.last_error_at && (
            <div className="text-red-500/60 mt-1">{new Date(health.last_error_at).toLocaleString("de")}</div>
          )}
        </div>
      )}
      {health && health.ok && health.key_set && (
        <div className="flex items-center gap-1.5 text-xs text-green-400">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
          Key konfiguriert — kein Fehler bekannt
        </div>
      )}
      {health && !health.key_set && (
        <div className="flex items-center gap-1.5 text-xs text-yellow-400">
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
          Kein API-Key konfiguriert
        </div>
      )}

      {/* Key input */}
      <form onSubmit={save} className="space-y-3 mt-1">
        <Field label="Anthropic API Key" hint="sk-ant-… — wird maskiert in .env gespeichert, nie in der UI angezeigt">
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="sk-ant-api03-… (leer = unverändert)"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500"
          />
        </Field>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={test}
            disabled={testing}
            className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-lg transition disabled:opacity-50"
          >
            {testing ? "Teste…" : "Verbindung testen"}
          </button>
          <button
            type="submit"
            disabled={saving || !apiKey}
            className="px-3 py-1.5 text-xs bg-indigo-700 hover:bg-indigo-600 text-white rounded-lg transition disabled:opacity-50"
          >
            {saving ? "Speichern…" : "Key speichern"}
          </button>
        </div>
        {result && (
          <p className={`text-xs ${result.ok ? "text-green-400" : "text-red-400"}`}>{result.text}</p>
        )}
      </form>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// v3.1 — Scan Universe Management
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Feature Flags — Paper Auto-Trading toggle
// ---------------------------------------------------------------------------
function FeatureFlagsSection() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);

  useEffect(() => {
    axios.get("/api/settings/feature-flags")
      .then(r => setEnabled(!!r.data.paper_auto_trading))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function toggle() {
    setSaving(true);
    setSaved(false);
    try {
      const next = !enabled;
      await axios.put("/api/settings/feature-flags", { paper_auto_trading: next });
      setEnabled(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {}
    setSaving(false);
  }

  return (
    <Section title="Feature Flags">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-gray-200 font-medium flex items-center gap-2">
            🤖 Paper Auto-Trading
            <span className="text-[10px] px-1.5 py-0.5 border border-yellow-700/50 rounded text-yellow-400">PAPER ONLY</span>
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Täglich 15:35 UTC werden aktive Kandidaten automatisch als Bracket Orders platziert.<br />
            Max 3 Trades · Max 5 % Kapital · Nur Paper-Konto · PDT-Schutz.
          </p>
        </div>
        <button
          onClick={toggle}
          disabled={loading || saving}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
            enabled ? "bg-indigo-600" : "bg-gray-700"
          }`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>
      {saved && <p className="text-xs text-green-400">✓ Gespeichert</p>}
    </Section>
  );
}

function UniverseSection() {
  const [universes, setUniverses] = useState([]);
  const [saving, setSaving] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const res = await axios.get("/api/universes");
      setUniverses(res.data || []);
    } catch {}
  }

  async function toggle(u) {
    setSaving(u.id);
    try {
      const res = await axios.patch(`/api/universes/${u.id}`, { is_active: !u.is_active });
      setUniverses(prev => prev.map(x => x.id === u.id ? res.data : x));
    } catch {}
    setSaving(null);
  }

  return (
    <Section title="Scan-Universen">
      <p className="text-xs text-gray-500 mb-3">
        Aktive Universen werden beim nächsten Scan kombiniert. S&P 500 ist immer verfügbar.
        ETF-Körbe ergänzen — ideal für Bear-Märkte.
      </p>
      <div className="space-y-2">
        {universes.map(u => {
          const regimes = (u.regime_default || "any").split(",").map(r => r.trim());
          return (
            <div key={u.id} className={`flex items-start gap-3 p-3 rounded-lg border transition ${
              u.is_active ? "border-indigo-700/40 bg-indigo-900/10" : "border-gray-800 bg-gray-900"
            }`}>
              <button
                onClick={() => toggle(u)}
                disabled={saving === u.id}
                className={`mt-0.5 w-9 h-5 rounded-full transition relative flex-shrink-0 ${
                  u.is_active ? "bg-indigo-600" : "bg-gray-700"
                } disabled:opacity-50`}
              >
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${
                  u.is_active ? "left-4" : "left-0.5"
                }`} />
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-white">{u.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-gray-700 text-gray-500">{u.type}</span>
                  {regimes.map(r => (
                    <span key={r} className={`text-[10px] px-1.5 py-0.5 rounded border ${REGIME_BADGE[r] ?? REGIME_BADGE.any}`}>
                      {r}
                    </span>
                  ))}
                  {u.requires_capability && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-yellow-700/40 bg-yellow-900/20 text-yellow-500">
                      {u.requires_capability}
                    </span>
                  )}
                </div>
                {u.description && (
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{u.description}</p>
                )}
                {u.tickers_json && u.tickers_source === "custom_json" && (
                  <p className="text-[11px] text-gray-600 mt-0.5 font-mono">
                    {JSON.parse(u.tickers_json || "[]").join(", ")}
                  </p>
                )}
                {u.risk_warning && (
                  <p className="text-[11px] text-amber-500/70 mt-1">⚠ {u.risk_warning}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}


// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function SettingsTab({ currentUser, onLogout }) {
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="mb-2">
        <h1 className="text-lg font-semibold text-white">Einstellungen</h1>
        <p className="text-xs text-gray-500 mt-0.5">Angemeldet als {currentUser?.email}</p>
      </div>

      <ErrorBoundary><NtfySection /></ErrorBoundary>
      <ErrorBoundary><ClaudeApiSection /></ErrorBoundary>
      <ErrorBoundary><BrokerManagementSection /></ErrorBoundary>
      <ErrorBoundary><FeatureFlagsSection /></ErrorBoundary>
      <ErrorBoundary><ModulesSection /></ErrorBoundary>
      <ErrorBoundary><UniverseSection /></ErrorBoundary>
      <ErrorBoundary><ScannerSection /></ErrorBoundary>
      <ErrorBoundary><PasswordSection currentUser={currentUser} onLogout={onLogout} /></ErrorBoundary>
    </div>
  );
}
