import { useState } from "react";
import axios from "axios";

export default function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post("/api/auth/login", { email, password });
      const { access_token } = res.data;
      localStorage.setItem("auth_token", access_token);
      axios.defaults.headers.common["Authorization"] = `Bearer ${access_token}`;
      onLogin(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || "Login fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white">Swing Scanner</h1>
          <p className="text-gray-500 text-sm mt-1">Bitte anmelden</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">E-Mail</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 transition"
              placeholder="admin@localhost"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Passwort</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSubmit(e)}
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500 transition"
            />
          </div>

          {error && (
            <div className="text-red-400 text-sm bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <><span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Anmelden…</>
            ) : "Anmelden"}
          </button>
        </form>

        <p className="text-center text-gray-600 text-xs mt-4">
          Swing Scanner v2.6 · Personal Edition
        </p>
      </div>
    </div>
  );
}
