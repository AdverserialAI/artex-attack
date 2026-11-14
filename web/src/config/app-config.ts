/**
 * app-config.ts: application-level static config (name, version, copyright, meta info).
 * Main functions/types:
 *   - APP_CONFIG: aggregated application config constants
 */
import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

export const APP_CONFIG = {
  name: "artex",
  version: packageJson.version,
  copyright: `© ${currentYear}, artex.`,
  meta: {
    title: "artex — Autonomous Pentest Console",
    description: "Console for the LLM-driven autonomous penetration testing system",
  },
};
