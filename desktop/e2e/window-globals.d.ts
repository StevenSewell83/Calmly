// Ambient declaration for `window.calmly` inside Playwright evaluate
// callbacks. Individual specs don't need per-file declare blocks.

import type { CalmlyApi } from "../src/preload/api-types";

declare global {
  // eslint-disable-next-line no-var
  var window: { calmly: CalmlyApi };
}

export {};
