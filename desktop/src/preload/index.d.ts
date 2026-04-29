import type { CalmlyApi } from "./index";

declare global {
  interface Window {
    calmly: CalmlyApi;
  }
}

export {};
