import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "../../config/i18n.js";

export const I18N_LOCALES = SUPPORTED_LOCALES as readonly ["zh-CN", "en"];
export type SupportedLocale = (typeof I18N_LOCALES)[number];

export const FALLBACK_LOCALE: SupportedLocale = DEFAULT_LOCALE as SupportedLocale;
