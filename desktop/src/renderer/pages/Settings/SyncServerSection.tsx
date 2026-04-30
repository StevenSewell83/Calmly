import { useState } from "react";
import {
  DEFAULT_SERVER_URL,
  SERVER_URL_ERRORS,
  validateServerUrl,
} from "@calmly/shared";

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; version: string }
  | { kind: "fail"; message: string };

export function SyncServerSection() {
  const [useCustom, setUseCustom] = useState(false);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [saving, setSaving] = useState(false);
  const [confirmSwitch, setConfirmSwitch] = useState(false);

  function handleToggle(custom: boolean) {
    if (!custom && useCustom && url) {
      setConfirmSwitch(true);
      return;
    }
    setUseCustom(custom);
    if (!custom) {
      setUrl("");
      setUrlError(null);
      setTest({ kind: "idle" });
    }
  }

  function handleUrlChange(v: string) {
    setUrl(v);
    setUrlError(null);
    setTest({ kind: "idle" });
  }

  async function handleTest() {
    const v = validateServerUrl(url);
    if (!v.ok) {
      setUrlError(SERVER_URL_ERRORS[v.error]);
      return;
    }
    setTest({ kind: "testing" });
    try {
      const res = await fetch(`${v.url}/health`);
      if (!res.ok) {
        setTest({ kind: "fail", message: `Server returned HTTP ${res.status}` });
        return;
      }
      let version = "unknown";
      try {
        const vres = await fetch(`${v.url}/version`);
        if (vres.ok) {
          const body = (await vres.json()) as { version?: string };
          version = body.version ?? "unknown";
        }
      } catch {
        // /version is optional
      }
      setTest({ kind: "ok", version });
    } catch (err) {
      setTest({
        kind: "fail",
        message: err instanceof Error ? err.message : "Connection failed",
      });
    }
  }

  async function handleSave() {
    const v = validateServerUrl(url);
    if (!v.ok) {
      setUrlError(SERVER_URL_ERRORS[v.error]);
      return;
    }
    setSaving(true);
    try {
      await window.calmly.settings.setSyncServerUrl(v.url);
    } finally {
      setSaving(false);
    }
  }

  if (confirmSwitch) {
    return (
      <div className="mt-8 bg-amber-50 border border-amber-200 rounded-[1.8rem] p-6">
        <p className="text-sm text-amber-900 font-medium">
          Switching to the hosted server will sign you out and reset local sync state. Your captured items stay on-device.
        </p>
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={() => {
              setUseCustom(false);
              setUrl("");
              setUrlError(null);
              setTest({ kind: "idle" });
              setConfirmSwitch(false);
            }}
            className="px-4 py-2 rounded-2xl bg-amber-700 text-white text-sm font-medium hover:bg-amber-600 transition-colors"
          >
            Switch to hosted
          </button>
          <button
            type="button"
            onClick={() => setConfirmSwitch(false)}
            className="px-4 py-2 rounded-2xl bg-white border border-amber-300 text-amber-900 text-sm font-medium hover:bg-amber-50 transition-colors"
          >
            Keep custom URL
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8 bg-white border border-stone-100 rounded-[1.8rem] p-6 shadow-sm">
      <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-stone-400">
        Sync server
      </span>

      <div className="mt-4 flex flex-col gap-3">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="radio"
            name="sync-server"
            checked={!useCustom}
            onChange={() => handleToggle(false)}
            className="accent-emerald-600"
          />
          <span className="text-sm text-stone-700">
            Calmly hosted{" "}
            <span className="text-stone-400 text-xs">(recommended)</span>
          </span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="radio"
            name="sync-server"
            checked={useCustom}
            onChange={() => handleToggle(true)}
            className="accent-emerald-600"
          />
          <span className="text-sm text-stone-700">Custom server URL</span>
        </label>
      </div>

      {useCustom && (
        <div className="mt-5 flex flex-col gap-3">
          <input
            type="url"
            value={url}
            onChange={(e) => handleUrlChange(e.target.value)}
            placeholder={DEFAULT_SERVER_URL}
            className={[
              "w-full px-4 py-2.5 rounded-2xl border text-sm text-stone-800 bg-stone-50 outline-none transition-colors",
              urlError
                ? "border-red-300 focus:border-red-400"
                : "border-stone-200 focus:border-emerald-400",
            ].join(" ")}
          />
          {urlError && (
            <p className="text-xs text-red-500">{urlError}</p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleTest}
              disabled={test.kind === "testing" || !url}
              className="px-4 py-2 rounded-2xl bg-stone-100 text-stone-700 text-sm font-medium hover:bg-stone-200 disabled:opacity-40 transition-colors"
            >
              {test.kind === "testing" ? "Testing…" : "Test connection"}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || test.kind !== "ok"}
              className="px-4 py-2 rounded-2xl bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-40 transition-colors"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>

          {test.kind === "ok" && (
            <p className="text-xs text-emerald-600">
              Connected — server version {test.version}
            </p>
          )}
          {test.kind === "fail" && (
            <p className="text-xs text-red-500">{test.message}</p>
          )}
        </div>
      )}
    </div>
  );
}
