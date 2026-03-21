import { useState, useEffect } from "react";
import axios from "axios";
import Dashboard from "./components/Dashboard.jsx";

export default function App() {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [scanStatus, setScanStatus] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);

  async function fetchCandidates() {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get("/api/candidates");
      setCandidates(res.data);
      setLastFetched(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function fetchScanStatus() {
    try {
      const res = await axios.get("/api/scan/status");
      setScanStatus(res.data);
    } catch {
      // silent
    }
  }

  async function triggerScan() {
    try {
      await axios.post("/api/scan/trigger");
      setScanStatus({ running: true });
      // Poll status every 5s while running
      const interval = setInterval(async () => {
        const res = await axios.get("/api/scan/status");
        setScanStatus(res.data);
        if (!res.data.running) {
          clearInterval(interval);
          fetchCandidates();
        }
      }, 5000);
    } catch (err) {
      setError("Failed to trigger scan: " + err.message);
    }
  }

  useEffect(() => {
    fetchCandidates();
    fetchScanStatus();
  }, []);

  return (
    <div className="min-h-screen bg-gray-950">
      <Dashboard
        candidates={candidates}
        loading={loading}
        error={error}
        scanStatus={scanStatus}
        lastFetched={lastFetched}
        onScanTrigger={triggerScan}
        onRefresh={fetchCandidates}
      />
    </div>
  );
}
