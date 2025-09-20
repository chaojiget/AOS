import { PHASE_PRODUCTION_BUILD } from "next/constants.js";
import { I18N_CONFIG } from "./config/i18n.js";

const baseConfig = {
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  // i18n配置将根据build模式动态决定
  experimental: {
    // 禁用Fast Refresh的一些严格检查以减少运行时错误
    swcTraceProfiling: false,
  },
};

/**
 * @param {string} phase
 * @returns {import('next').NextConfig}
 */
const createConfig = (phase) => {
  if (phase === PHASE_PRODUCTION_BUILD) {
    return {
      ...baseConfig,
      distDir: "out",
      output: "export",
      // 静态导出模式下不使用i18n（避免冲突）
    };
  }

  return {
    ...baseConfig,
    i18n: I18N_CONFIG, // 开发/正常模式下使用i18n
  };
};

export default createConfig;
