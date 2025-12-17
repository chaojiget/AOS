"use client";

import { useI18n } from "@/i18n";

export function LanguageToggle() {
  const { lang, setLang } = useI18n();

  return (
    <div className="inline-flex items-center rounded-md border border-white/10 bg-white/5 p-1 backdrop-blur">
      <button
        type="button"
        onClick={() => setLang("zh")}
        className={[
          "rounded-sm px-2 py-1 text-xs",
          lang === "zh" ? "bg-white/20 text-white" : "text-zinc-300 hover:bg-white/10",
        ].join(" ")}
      >
        中文
      </button>
      <button
        type="button"
        onClick={() => setLang("en")}
        className={[
          "rounded-sm px-2 py-1 text-xs",
          lang === "en" ? "bg-white/20 text-white" : "text-zinc-300 hover:bg-white/10",
        ].join(" ")}
      >
        EN
      </button>
    </div>
  );
}
