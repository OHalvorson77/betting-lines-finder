import { fetchPredictions } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function PredictionsPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const page = Number(searchParams.page ?? 1);

  let result;
  try {
    result = await fetchPredictions(page, 20);
  } catch {
    result = { data: [], total: 0, page: 1, limit: 20, totalPages: 0 };
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Predictions</h1>
        <p className="mt-1 text-gray-500">{result.total} total predictions</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {result.data.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <p className="text-lg font-medium">No predictions found</p>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {["Subject", "Source", "Confidence", "Predicted At", "Status"].map((h) => (
                  <th
                    key={h}
                    className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {result.data.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-medium text-gray-900 max-w-xs truncate">{p.subject}</p>
                    <p className="text-sm text-gray-500 max-w-xs truncate mt-0.5">{p.content}</p>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{p.source}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {p.confidence != null ? `${(p.confidence * 100).toFixed(0)}%` : "—"}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {new Date(p.predictedAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {result.totalPages > 1 && (
        <Pagination currentPage={result.page} totalPages={result.totalPages} />
      )}
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
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status] ?? "bg-gray-100 text-gray-600"}`}
    >
      {status}
    </span>
  );
}

function Pagination({ currentPage, totalPages }: { currentPage: number; totalPages: number }) {
  return (
    <nav className="flex items-center justify-between">
      <a
        href={`/predictions?page=${Math.max(1, currentPage - 1)}`}
        className={`px-4 py-2 text-sm font-medium rounded-lg border ${
          currentPage <= 1
            ? "text-gray-300 border-gray-200 cursor-not-allowed pointer-events-none"
            : "text-gray-700 border-gray-300 hover:bg-gray-50"
        }`}
      >
        ← Previous
      </a>
      <span className="text-sm text-gray-500">
        Page {currentPage} of {totalPages}
      </span>
      <a
        href={`/predictions?page=${Math.min(totalPages, currentPage + 1)}`}
        className={`px-4 py-2 text-sm font-medium rounded-lg border ${
          currentPage >= totalPages
            ? "text-gray-300 border-gray-200 cursor-not-allowed pointer-events-none"
            : "text-gray-700 border-gray-300 hover:bg-gray-50"
        }`}
      >
        Next →
      </a>
    </nav>
  );
}
