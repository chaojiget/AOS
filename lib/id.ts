const DEFAULT_LENGTH = 8;

export function generateShortId(length = DEFAULT_LENGTH): string {
  const target = Math.max(4, Math.floor(length));
  let result = "";
  while (result.length < target) {
    result += Math.random().toString(36).slice(2);
  }
  return result.slice(0, target);
}

export function formatShortId(value: string, length = DEFAULT_LENGTH): string {
  if (!value) {
    return "";
  }
  const safeLength = Math.max(4, Math.floor(length));
  if (value.length <= safeLength) {
    return value;
  }
  return `${value.slice(0, safeLength - 1)}…`;
}
