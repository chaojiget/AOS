const DEFAULT_BACKEND_URL = "http://localhost:3001";

const rawBackendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? DEFAULT_BACKEND_URL;

export const API_BASE_URL = rawBackendUrl.replace(/\/+$/, "");

export const CHAT_ENDPOINT = `${API_BASE_URL}/api/chat`;

export const telemetryEndpoint = (path: string) => `${API_BASE_URL}/api/telemetry/${path}`;
