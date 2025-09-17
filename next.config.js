import { PHASE_PRODUCTION_BUILD } from "next/constants.js";
import { I18N_CONFIG } from "./config/i18n.js";

const baseConfig = {
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  i18n: I18N_CONFIG,
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
    };
  }

  return { ...baseConfig };
};

export default createConfig;
