export function backendBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_AOS_BACKEND_URL ?? "http://localhost:8080";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${backendBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const response = await fetch(url, {
    ...init,
    method: "GET",
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText}${text ? `: ${text}` : ""}`);
  }

  return (await response.json()) as T;
}

