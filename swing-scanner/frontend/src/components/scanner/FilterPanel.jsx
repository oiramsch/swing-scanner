import { useState, useEffect } from "react";
import axios from "axios";

const DEFAULT = {
  name: "Standard",
  price_min: 10,
  price_max: 500,
  avg_volume_min: 500000,
  float_min: "",
  float_max: "",
  market_cap: "all",
  exchanges: ["NYSE", "NASDAQ"],
  country: ["US"],
  sectors: [],
  rsi_min: 45,
  rsi_max: 70,
  price_above_sma20: false,
  price_above_sma50: true,
  confidence_min: 6,
  respect_market_regime: true,
  setup_types: ["breakout", "pullback", "pattern", "momentum"],
};

const SETUP_OPTIONS = ["breakout", "pullback", "pattern", "momentum"];
const EXCHANGE_OPTIONS = ["NYSE", "NASDAQ", "AMEX", "OTC"];
const COUNTRY_OPTIONS = ["US", "CA", "GB", "DE", "FR", "JP"];
const MARKET_CAP_OPTIONS = ["all", "micro", "small", "mid", "large", "mega"];
const SECTOR_OPTIONS = [
  "Technology", "Healthcare", "Financial Services", "Consumer Cyclical",
  "Industrials", "Communication Services", "Consumer Defensive",
  "Energy", "Basic Materials", "Real Estate", "Utilities",
];

function parseJSON(val, fallback) {
  try { return typeof val === "string" ? JSON.parse(val) : val ?? fallback; }
  catch { return fallback; }
}

function toEditing(p) {
  return {
    ...p,
    setup_types: parseJSON(p.setup_types, SETUP_OPTIONS),
    exchanges: parseJSON(p.exchanges, ["NYSE", "NASDAQ"]),
    country: parseJSON(p.country, ["US"]),
    sectors: parseJSON(p.sectors, []),
    float_min: p.float_min ?? "",
    float_max: p.float_max ?? "",
  };
}

function toPayload(e) {
  return {
    ...e,
    setup_types: JSON.stringify(e.setup_types),
    exchanges: JSON.stringify(e.exchanges),
    country: JSON.stringify(e.country),
    sectors: JSON.stringify(e.sectors),
    float_min: e.float_min === "" ? null : Number(e.float_min),
    float_max: e.float_max === "" ? null : Number(e.float_max),
  };
}

function toggle(arr, val) {
  return arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val];
}

export default function FilterPanel({ onClose }) {
  const [profiles, setProfiles] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(null);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const res = await axios.get("/api/filters");
      setProfiles(res.data);
      const active = res.data.find(p => p.is_active);
      if (active) setActiveId(active.id);
    } catch {}
  }

  async function deleteProfile(id) {
    if (!confirm("Filter-Profile wirklich löschen?")) return;
    setDeleting(id);
    try {
      await axios.delete(`/api/filters/${id}`);
      setProfiles(ps => ps.filter(p => p.id !== id));
    } catch {}
    setDeleting(null);
  }

  async function activate(id) {
    setActivating(id);
    try {
      await axios.post(`/api/filters/${id}/activate`);
      setActiveId(id);
      setProfiles(ps => ps.map(p => ({ ...p, is_active: p.id === id })));
    } catch {}
    setActivating(null);
  }

  async function save() {
    setSaving(true);
    try {
      const payload = toPayload(editing);
      if (editing.id) {
        // Update existing profile
        await axios.put(`/api/filters/${editing.id}`, payload);
        await load();
      } else {
        // Create new profile
        const res = await axios.post("/api/filters", payload);
        setProfiles(ps => [...ps, res.data]);
      }
      setEditing(null);
    } catch {}
    setSaving(false);
  }

  function set(key, val) {
    setEditing(e => ({ ...e, [key]: val }));
  }

  // ── Edit form ──────────────────────────────────────────────────────────────
  if (editing) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold text-sm">
            {editing.id ? `Bearbeiten: ${editing.name}` : "Neues Filter-Profile"}
          </h3>
          <button onClick={() => setEditing(null)} className="text-gray-500 hover:text-gray-300 text-xs">✕ Abbrechen</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Name */}
          <div className="col-span-full">
            <label className="block text-xs text-gray-400 mb-1">Name</label>
            <input value={editing.name}
              onChange={e => set("name", e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Price */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Preis Min ($)</label>
            <input type="number" value={editing.price_min}
              onChange={e => set("price_min", +e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Preis Max ($)</label>
            <input type="number" value={editing.price_max}
              onChange={e => set("price_max", +e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Volume */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Avg. Volumen Min</label>
            <input type="number" value={editing.avg_volume_min}
              onChange={e => set("avg_volume_min", +e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Float */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Float Min (Mio.)</label>
            <input type="number" value={editing.float_min} placeholder="—"
              onChange={e => set("float_min", e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Float Max (Mio.)</label>
            <input type="number" value={editing.float_max} placeholder="—"
              onChange={e => set("float_max", e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* RSI */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">RSI Min</label>
            <input type="number" value={editing.rsi_min} min={0} max={100}
              onChange={e => set("rsi_min", +e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">RSI Max</label>
            <input type="number" value={editing.rsi_max} min={0} max={100}
              onChange={e => set("rsi_max", +e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Confidence + Market Cap */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Min. Confidence (KI)</label>
            <select value={editing.confidence_min}
              onChange={e => set("confidence_min", +e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
            >
              {[5,6,7,8,9].map(v => <option key={v} value={v}>≥ {v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Market Cap</label>
            <select value={editing.market_cap}
              onChange={e => set("market_cap", e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
            >
              {MARKET_CAP_OPTIONS.map(v => <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>)}
            </select>
          </div>

          {/* Checkboxes */}
          <div className="col-span-full flex flex-wrap gap-4">
            {[
              ["price_above_sma20", "Preis > SMA20"],
              ["price_above_sma50", "Preis > SMA50"],
              ["respect_market_regime", "Market Regime berücksichtigen"],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={editing[key]}
                  onChange={e => set(key, e.target.checked)}
                  className="w-4 h-4 accent-indigo-500"
                />
                <span className="text-sm text-gray-300">{label}</span>
              </label>
            ))}
          </div>

          {/* Setup types */}
          <div className="col-span-full">
            <label className="block text-xs text-gray-400 mb-2">Setup-Typen</label>
            <div className="flex gap-2 flex-wrap">
              {SETUP_OPTIONS.map(type => (
                <button key={type} type="button"
                  onClick={() => set("setup_types", toggle(editing.setup_types, type))}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
                    editing.setup_types.includes(type)
                      ? "bg-indigo-600 border-indigo-500 text-white"
                      : "bg-gray-800 border-gray-700 text-gray-400"
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Exchanges */}
          <div className="col-span-full sm:col-span-1">
            <label className="block text-xs text-gray-400 mb-2">Exchanges</label>
            <div className="flex gap-2 flex-wrap">
              {EXCHANGE_OPTIONS.map(ex => (
                <button key={ex} type="button"
                  onClick={() => set("exchanges", toggle(editing.exchanges, ex))}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
                    editing.exchanges.includes(ex)
                      ? "bg-blue-600 border-blue-500 text-white"
                      : "bg-gray-800 border-gray-700 text-gray-400"
                  }`}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>

          {/* Country */}
          <div className="col-span-full sm:col-span-1">
            <label className="block text-xs text-gray-400 mb-2">Länder</label>
            <div className="flex gap-2 flex-wrap">
              {COUNTRY_OPTIONS.map(c => (
                <button key={c} type="button"
                  onClick={() => set("country", toggle(editing.country, c))}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
                    editing.country.includes(c)
                      ? "bg-green-700 border-green-600 text-white"
                      : "bg-gray-800 border-gray-700 text-gray-400"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Sectors */}
          <div className="col-span-full">
            <label className="block text-xs text-gray-400 mb-2">Sektoren <span className="text-gray-600">(leer = alle)</span></label>
            <div className="flex gap-2 flex-wrap">
              {SECTOR_OPTIONS.map(s => (
                <button key={s} type="button"
                  onClick={() => set("sectors", toggle(editing.sectors, s))}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
                    editing.sectors.includes(s)
                      ? "bg-amber-700 border-amber-600 text-white"
                      : "bg-gray-800 border-gray-700 text-gray-400"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={() => setEditing(null)}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 rounded-lg transition">
            Abbrechen
          </button>
          <button onClick={save} disabled={saving || !editing.name}
            className="px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition disabled:opacity-50">
            {saving ? "Speichern…" : "Speichern"}
          </button>
        </div>
      </div>
    );
  }

  // ── Profile list ───────────────────────────────────────────────────────────
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-semibold text-sm">Filter-Profile</h3>
        <div className="flex gap-2">
          <button onClick={() => setEditing({ ...DEFAULT })}
            className="text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition">
            + Neu
          </button>
          {onClose && (
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xs px-2">✕</button>
          )}
        </div>
      </div>

      {profiles.length === 0 ? (
        <p className="text-gray-500 text-sm py-2">
          Noch kein Filter-Profile. Standard-Filter wird verwendet.{" "}
          <button onClick={() => setEditing({ ...DEFAULT })} className="text-indigo-400 hover:underline">Jetzt erstellen</button>
        </p>
      ) : (
        <div className="space-y-2">
          {profiles.map(p => {
            const isActive = p.id === activeId;
            const setups = parseJSON(p.setup_types, []);
            const exchanges = parseJSON(p.exchanges, []);
            const sectors = parseJSON(p.sectors, []);
            return (
              <div key={p.id} className={`flex items-center justify-between p-3 rounded-lg border transition ${
                isActive ? "border-indigo-500/50 bg-indigo-500/10" : "border-gray-800 bg-gray-800/50"
              }`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white">{p.name}</span>
                    {isActive && <span className="text-xs px-1.5 py-0.5 bg-indigo-600 text-white rounded-full">Aktiv</span>}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5 truncate">
                    RSI {p.rsi_min}–{p.rsi_max} · ${p.price_min}–${p.price_max} · Vol ≥{(p.avg_volume_min/1e6).toFixed(1)}M · Conf ≥{p.confidence_min}
                    {exchanges.length > 0 && <> · {exchanges.join("/")}</>}
                    {sectors.length > 0 && <> · {sectors.slice(0,2).join(", ")}{sectors.length > 2 ? "…" : ""}</>}
                  </div>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {setups.map(st => (
                      <span key={st} className="text-xs px-1.5 py-0.5 bg-gray-700 text-gray-300 rounded">{st}</span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 ml-3 shrink-0">
                  <button onClick={() => setEditing(toEditing(p))}
                    className="text-xs px-2 py-1 text-gray-400 hover:text-gray-200 bg-gray-700 hover:bg-gray-600 rounded transition">
                    Bearbeiten
                  </button>
                  {!isActive && (
                    <button onClick={() => activate(p.id)} disabled={activating === p.id}
                      className="text-xs px-2 py-1 text-indigo-400 hover:text-white bg-indigo-900/50 hover:bg-indigo-600 border border-indigo-500/40 rounded transition disabled:opacity-50">
                      {activating === p.id ? "…" : "Aktivieren"}
                    </button>
                  )}
                  <button
                    onClick={() => !isActive && deleteProfile(p.id)}
                    disabled={isActive || deleting === p.id}
                    title={isActive ? "Zuerst anderes Profil aktivieren" : "Löschen"}
                    className={`text-xs px-2 py-1 rounded transition ${
                      isActive
                        ? "text-gray-600 bg-gray-800 cursor-not-allowed"
                        : "text-red-400 hover:text-white bg-red-900/30 hover:bg-red-700 border border-red-800/40 disabled:opacity-50"
                    }`}
                  >
                    {deleting === p.id ? "…" : "🗑"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
