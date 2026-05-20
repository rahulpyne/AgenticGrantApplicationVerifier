import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getManagerQueue } from "../api";

interface QueueEntry {
  case_id: string;
  basket: string;
  applicant_name?: string;
}

export default function ManagerQueue() {
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getManagerQueue()
      .then(setQueue)
      .catch(() => setQueue([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="page-title">Manager Confirmation Queue</h1>
      <div className="alert alert-error" style={{ marginBottom: 20 }}>
        <span>⛔</span>
        <div>
          <strong>Decline Basket cases require manager confirmation.</strong>
          <div className="text-sm mt-2">These applications have 3 or more missing required documents. A manager must review and confirm or override the routing before any decline notice can be generated.</div>
        </div>
      </div>
      <div className="card">
        <div className="card-header">Pending Confirmations ({queue.length})</div>
        {loading ? (
          <div className="card-body text-muted">Loading…</div>
        ) : queue.length === 0 ? (
          <div className="card-body text-muted">No cases awaiting manager confirmation.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Case ID</th>
                <th>Applicant</th>
                <th>Basket</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((entry) => (
                <tr key={entry.case_id}>
                  <td><code style={{ fontSize: 12 }}>{entry.case_id}</code></td>
                  <td className="fw-600">{entry.applicant_name ?? "—"}</td>
                  <td><span className="chip chip-decline_basket">Decline Basket</span></td>
                  <td>
                    <Link to={`/cases/${entry.case_id}`}>
                      <button className="btn-danger" style={{ padding: "4px 12px", fontSize: 13 }}>
                        Review &amp; Decide →
                      </button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
