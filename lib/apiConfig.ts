const DEFAULT_BACKEND_URL = "http://localhost:3001";

const sanitizeUrl = (url: string) => url.replace(/\/+$/, "");

const appendPath = (base: string, path: string) => {
  const trimmed = path.trim();
  if (!trimmed) {
    return base;
  }
  const sanitized = trimmed.replace(/^\/+/, "");
  if (!sanitized) {
    return base;
  }
  return `${base}/${sanitized}`;
};

const resolveBackendUrl = () => {
  const envUrl = process.env.NEXT_PUBLIC_BACKEND_URL?.trim();
  if (envUrl) {
    return sanitizeUrl(envUrl);
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    const port = process.env.NEXT_PUBLIC_BACKEND_PORT ?? "3001";
    return sanitizeUrl(`${protocol}//${hostname}:${port}`);
  }

  return sanitizeUrl(DEFAULT_BACKEND_URL);
};

export const getApiBaseUrl = () => resolveBackendUrl();

export const getChatEndpoint = () => `${getApiBaseUrl()}/api/chat`;
export const getChatStreamEndpoint = () => `${getApiBaseUrl()}/api/chat/stream`;

export const telemetryEndpoint = (path: string) => appendPath(`${getApiBaseUrl()}/api/telemetry`, path);

export const getMcpEndpoint = (path: string) => appendPath(`${getApiBaseUrl()}/mcp`, path);
export const getProjectsEndpoint = (path = '') => appendPath(`${getApiBaseUrl()}/api/projects`, path);
