import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "standalone/portfolio/sprinthost-install.test.mjs", "standalone/portfolio-cloudflare/deploy.test.mjs"],
  },
});
