const STORAGE_KEY = 'aos-api-token';
export const API_TOKEN_EVENT = 'aos-api-token-changed';

const dispatchTokenChange = (token: string | null) => {
  if (typeof window === 'undefined') return;
  const event = new CustomEvent<string | null>(API_TOKEN_EVENT, { detail: token });
  window.dispatchEvent(event);
};

export const getStoredApiToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEY);
};

export const setStoredApiToken = (token: string) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, token);
  dispatchTokenChange(token);
};

export const clearStoredApiToken = () => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
  dispatchTokenChange(null);
};

export const onApiTokenChange = (listener: (token: string | null) => void) => {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleCustom: EventListener = (event) => {
    const detail = (event as CustomEvent<string | null>).detail;
    listener(typeof detail === 'string' ? detail : null);
  };

  const handleStorage = () => {
    listener(getStoredApiToken());
  };

  window.addEventListener(API_TOKEN_EVENT, handleCustom);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener(API_TOKEN_EVENT, handleCustom);
    window.removeEventListener('storage', handleStorage);
  };
};
