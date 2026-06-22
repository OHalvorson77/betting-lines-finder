import { fetchPredictions } from "@/lib/api";

export const dynamic = "force-dynamic";

async function StatsCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
      {sub && <p className="mt-1 text-sm text-gray-400">{sub}</p>}
    </div>
  );
}

export default async function DashboardPage() {
  let predictions;
  try {
    predictions = await fetchPredictions(1, 5);
  } catch {
    predictions = { data: [], total: 0, page: 1, limit: 5, totalPages: 0 };
  }

  const completed = predictions.data.filter((p) => p.status === "completed").length;
  const pending = predictions.data.filter((p) => p.status === "pending").length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-gray-500">Overview of tracked predictions</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatsCard label="Total Predictions" value={predictions.total} />
        <StatsCard label="Completed" value={completed} />
        <StatsCard label="Pending" value={pending} />
      </div>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Recent Predictions</h2>
          <a
            href="/predictions"
            className="text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors"
          >
            View all →
          </a>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {predictions.data.length === 0 ? (
            <div className="py-12 text-center text-gray-400">
              <p className="text-lg">No predictions yet</p>
              <p className="text-sm mt-1">Predictions will appear here once the worker processes them.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {predictions.data.map((p) => (
                <li key={p.id} className="px-6 py-4 flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900 truncate">{p.subject}</p>
                    <p className="text-sm text-gray-500 truncate mt-0.5">{p.source}</p>
                  </div>
                  <StatusBadge status={p.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: "bg-green-100 text-green-700",
    pending: "bg-yellow-100 text-yellow-700",
    processing: "bg-blue-100 text-blue-700",
    failed: "bg-red-100 text-red-700",
  };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0 ${styles[status] ?? "bg-gray-100 text-gray-600"}`}
    >
      {status}
    </span>
  );
}
