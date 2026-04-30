// Ambient declaration for `window.calmly` inside Playwright evaluate
// callbacks. The e2e tsconfig (tsconfig.node.json) sets `lib: ["ES2022"]`
// without DOM, so `window` isn't typed by default. Each evaluate() body
// runs in the renderer's browser context where preload's
// `contextBridge.exposeInMainWorld("calmly", ...)` makes window.calmly
// real. This file types it once for every e2e file so individual specs
// don't have to re-declare a partial slice of CalmlyApi each time.
//
// Why a .d.ts and not a re-exported type: TS `declare const window`
// is module-scoped, so a type alias would still need the per-spec
// `declare` line. `declare global { var window }` in a .d.ts is the
// idiomatic way to ambient-augment a global, and it's contained to
// the e2e/ tree by convention (main + preload don't reference window).

import type { CalmlyApi } from "../src/preload/api-types";

declare global {
  // eslint-disable-next-line no-var
  var window: { calmly: CalmlyApi };
}

export {};
