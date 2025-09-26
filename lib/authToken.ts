const STORAGE_KEY = 'aos-api-token';

export const getStoredApiToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEY);
};

export const setStoredApiToken = (token: string) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, token);
};

export const clearStoredApiToken = () => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
};
