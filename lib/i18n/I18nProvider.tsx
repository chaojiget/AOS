import { createContext, useContext, useMemo } from "react";
import type { FC, ReactNode } from "react";

import { FALLBACK_LOCALE, type SupportedLocale } from "./config";
import enMessages from "../../locales/en/common.json" with { type: "json" };
import zhCNMessages from "../../locales/zh-CN/common.json" with { type: "json" };

type MessageDictionary = typeof enMessages;

type MessageRecord = Record<SupportedLocale, MessageDictionary>;

type InterpolationValues = Record<string, string | number>;

type I18nContextValue = {
  locale: SupportedLocale;
  messages: MessageDictionary;
  t: (key: string, values?: InterpolationValues) => string;
};

const messageStore: MessageRecord = {
  "zh-CN": zhCNMessages,
  en: enMessages,
};

const I18nContext = createContext<I18nContextValue>({
  locale: FALLBACK_LOCALE,
  messages: messageStore[FALLBACK_LOCALE],
  t: (key: string) => key,
});

const resolveMessage = (messages: MessageDictionary, key: string): string | undefined => {
  return key.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object" && part in acc) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, messages) as string | undefined;
};

const interpolate = (template: string, values: InterpolationValues | undefined) => {
  if (!values) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, token) => {
    const value = values[token];
    return value === undefined || value === null ? match : String(value);
  });
};

export interface I18nProviderProps {
  locale?: SupportedLocale | string | null;
  children: ReactNode;
}

export const I18nProvider: FC<I18nProviderProps> = ({ locale, children }) => {
  const targetLocale: SupportedLocale =
    locale && locale in messageStore ? (locale as SupportedLocale) : FALLBACK_LOCALE;

  const value = useMemo<I18nContextValue>(() => {
    const messages = messageStore[targetLocale] ?? messageStore[FALLBACK_LOCALE];
    const translate = (key: string, values?: InterpolationValues) => {
      const resolved = resolveMessage(messages, key);
      if (typeof resolved === "string") {
        return interpolate(resolved, values);
      }
      return key;
    };
    return {
      locale: targetLocale,
      messages,
      t: translate,
    };
  }, [targetLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => useContext(I18nContext);
