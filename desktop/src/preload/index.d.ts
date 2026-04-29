import type { CalmlyApi } from "./api-types";

declare global {
  interface Window {
    calmly: CalmlyApi;
  }
}

export {};
