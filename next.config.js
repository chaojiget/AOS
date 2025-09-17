import { PHASE_PRODUCTION_BUILD } from "next/constants";

const baseConfig = {
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
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
