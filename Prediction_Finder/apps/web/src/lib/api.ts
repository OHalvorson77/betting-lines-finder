import type { ApiResponse, PaginatedResponse, Prediction } from "@prediction-finder/shared";

const API_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });

  const json = (await res.json()) as ApiResponse<T>;

  if (!json.success) {
    throw new Error(json.error.message);
  }

  return json.data;
}

export async function fetchPredictions(page = 1, limit = 20) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  const res = await fetch(`${API_URL}/api/v1/predictions?${params.toString()}`);
  return res.json() as Promise<PaginatedResponse<Prediction>>;
}

export async function fetchPrediction(id: string) {
  return apiFetch<Prediction>(`/predictions/${id}`);
}

export async function deletePrediction(id: string) {
  await fetch(`${API_URL}/api/v1/predictions/${id}`, { method: "DELETE" });
}
