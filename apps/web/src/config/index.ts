import { parseBrowserConfig } from './browser-config';
export const browserConfig = parseBrowserConfig({
  VITE_DATA_MODE: import.meta.env.VITE_DATA_MODE,
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
  VITE_APP_VERSION: import.meta.env.VITE_APP_VERSION,
});
