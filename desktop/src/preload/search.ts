import { ipcRenderer } from "electron";
import type { SearchBridge, SearchQueryResult } from "./api-types";

export const searchBridge: SearchBridge = {
  query(q: string): Promise<SearchQueryResult> {
    return ipcRenderer.invoke("search:query", q) as Promise<SearchQueryResult>;
  },
};
