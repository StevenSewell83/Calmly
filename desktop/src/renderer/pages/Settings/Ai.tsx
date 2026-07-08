import { useState, useEffect } from "react";
import {
  Brain,
  Eye,
  EyeOff,
  CheckCircle,
  XCircle,
  Loader2,
  Info,
} from "lucide-react";
import type { AiSettings, AiTestResult } from "../../../preload/api-types";
import { AIUsagePanel } from "./AIUsagePanel";

type KeyState =
  | { kind: "unknown" }
  | { kind: "none" }
  | { kind: "set"; last4: string }
  | { kind: "editing" };

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok" }
  | { kind: "fail"; message: string };

type SaveState = "idle" | "saving" | "saved" | "error";

export function SettingsAi() {
  const [settings, setSettings] = useState<AiSettings>({
    enabled: false,
    mode: "off",
  });
  const [keyState, setKeyState] = useState<KeyState>({ kind: "unknown" });
  const [keyInput, setKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [savingKey, setSavingKey] = useState<SaveState>("idle");
  const [savingSettings, setSavingSettings] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    void loadInitialState();
  }, []);

  async function loadInitialState() {
    try {
      const [s, hasKey] = await Promise.all([
        window.calmly.ai.getSettings(),
        window.calmly.ai.hasKey(),
      ]);
      setSettings(s);
      setKeyState(hasKey ? { kind: "set", last4: "••••" } : { kind: "none" });
    } catch {
      setLoadError("Failed to load AI settings.");
    }
  }

  async function handleToggleEnabled(enabled: boolean) {
    setSettings((s) => ({ ...s, enabled }));
    setSavingSettings(true);
    try {
      await window.calmly.ai.setSettings({ enabled });
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleModeChange(mode: AiSettings["mode"]) {
    setSettings((s) => ({ ...s, mode }));
    setSavingSettings(true);
    try {
      await window.calmly.ai.setSettings({ mode });
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleSaveKey() {
    if (!keyInput.trim()) return;
    setSavingKey("saving");
    try {
      const result = await window.calmly.ai.setKey(keyInput.trim());
      if (result.ok) {
        setSavingKey("saved");
        const last4 = keyInput.trim().slice(-4);
        setKeyInput("");
        setShowKey(false);
        setKeyState({ kind: "set", last4 });
        setTest({ kind: "idle" });
        setTimeout(() => setSavingKey("idle"), 2000);
      } else {
        setSavingKey("error");
        setTimeout(() => setSavingKey("idle"), 3000);
      }
    } catch {
      setSavingKey("error");
      setTimeout(() => setSavingKey("idle"), 3000);
    }
  }

  async function handleRemoveKey() {
    await window.calmly.ai.clearKey();
    setKeyState({ kind: "none" });
    setKeyInput("");
    setTest({ kind: "idle" });
    setSettings((s) => ({ ...s, enabled: false }));
    await window.calmly.ai.setSettings({ enabled: false });
  }

  async function handleTestConnection() {
    setTest({ kind: "testing" });
    const result: AiTestResult = await window.calmly.ai.testConnection();
    if (result.ok) {
      setTest({ kind: "ok" });
    } else {
      const msg =
        result.error === "NoKey"
          ? "No API key saved yet."
          : result.error === "InvalidKey"
            ? "API key is invalid or revoked."
            : result.error === "NetworkError"
              ? `Network error: ${result.message ?? ""}`
              : (result.message ?? "Unknown error");
      setTest({ kind: "fail", message: msg });
    }
  }

  const keyIsSet = keyState.kind === "set";

  if (loadError) {
    return (
      <div className="px-10 py-12">
        <p className="text-sm text-red-500">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="px-10 py-12 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-9 h-9 rounded-2xl bg-emerald-50 flex items-center justify-center">
          <Brain size={18} className="text-emerald-600" />
        </div>
        <div>
          <h1 className="font-serif italic text-2xl text-stone-800 leading-tight">
            AI
          </h1>
          <p className="text-xs text-stone-400 mt-0.5">
            Bring your own Anthropic key — your data stays on-device.
          </p>
        </div>
        {savingSettings && (
          <Loader2 size={14} className="text-stone-300 animate-spin ml-auto" />
        )}
      </div>

      {/* Enable toggle */}
      <div className="bg-white border border-stone-100 rounded-[1.8rem] p-6 shadow-sm mb-4">
        <label className="flex items-center justify-between cursor-pointer select-none">
          <div>
            <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-stone-400 block mb-1">
              AI features
            </span>
            <span className="text-sm text-stone-700 font-medium">
              Enable AI assistance
            </span>
            <p className="text-xs text-stone-400 mt-0.5">
              Triage suggestions, brain-dump splitting, task refinement
            </p>
          </div>
          <button
            role="switch"
            aria-checked={settings.enabled}
            onClick={() => void handleToggleEnabled(!settings.enabled)}
            disabled={!keyIsSet}
            className={[
              "relative w-11 h-6 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
              settings.enabled ? "bg-emerald-500" : "bg-stone-200",
              !keyIsSet ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
            ].join(" ")}
          >
            <span
              className={[
                "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform",
                settings.enabled ? "translate-x-5" : "translate-x-0",
              ].join(" ")}
            />
          </button>
        </label>
        {!keyIsSet && keyState.kind !== "unknown" && (
          <p className="text-xs text-stone-400 mt-3 flex items-center gap-1.5">
            <Info size={12} />
            Save an API key below to enable AI features.
          </p>
        )}
      </div>

      {/* Mode selector */}
      <div className="bg-white border border-stone-100 rounded-[1.8rem] p-6 shadow-sm mb-4">
        <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-stone-400 block mb-4">
          AI mode
        </span>
        <div className="flex flex-col gap-2">
          {(["off", "cloud"] as const).map((mode) => (
            <label
              key={mode}
              className="flex items-center gap-3 cursor-pointer"
            >
              <input
                type="radio"
                name="ai-mode"
                value={mode}
                checked={settings.mode === mode}
                onChange={() => void handleModeChange(mode)}
                className="accent-emerald-600"
              />
              <span className="text-sm text-stone-700">
                {mode === "off" ? "Off" : "Cloud only"}
              </span>
            </label>
          ))}
          {(["Local only", "Hybrid"] as const).map((label) => (
            <label
              key={label}
              className="flex items-center gap-3 cursor-not-allowed opacity-40"
              title="Available in v1.1"
            >
              <input
                type="radio"
                name="ai-mode"
                disabled
                className="accent-stone-300"
              />
              <span className="text-sm text-stone-500">{label}</span>
              <span className="text-[10px] bg-stone-100 text-stone-400 rounded-full px-2 py-0.5 font-medium">
                v1.1
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Provider (read-only) */}
      <div className="bg-white border border-stone-100 rounded-[1.8rem] p-6 shadow-sm mb-4">
        <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-stone-400 block mb-3">
          Cloud provider
        </span>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-stone-50 border border-stone-200 flex items-center justify-center">
            <span className="text-xs font-bold text-stone-600">A</span>
          </div>
          <div>
            <span className="text-sm text-stone-700 font-medium">
              Anthropic
            </span>
            <p className="text-xs text-stone-400">
              OpenAI and others available in v1.1
            </p>
          </div>
        </div>
      </div>

      {/* Usage panel */}
      <AIUsagePanel />

      {/* API key management */}
      <div className="bg-white border border-stone-100 rounded-[1.8rem] p-6 shadow-sm">
        <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-stone-400 block mb-4">
          Anthropic API key
        </span>

        {keyIsSet && keyState.kind === "set" ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 bg-stone-50 rounded-2xl px-4 py-3 border border-stone-200">
              <span className="text-sm text-stone-600 font-mono flex-1">
                ••••••••••••••••{keyState.last4}
              </span>
              <button
                type="button"
                onClick={() => {
                  setKeyState({ kind: "editing" });
                  setTest({ kind: "idle" });
                }}
                className="text-xs text-stone-400 hover:text-stone-600 transition-colors"
              >
                Replace
              </button>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => void handleTestConnection()}
                disabled={test.kind === "testing"}
                className="px-4 py-2 rounded-2xl bg-stone-100 text-stone-700 text-sm font-medium hover:bg-stone-200 disabled:opacity-40 transition-colors flex items-center gap-2"
              >
                {test.kind === "testing" && (
                  <Loader2 size={13} className="animate-spin" />
                )}
                {test.kind === "testing" ? "Testing…" : "Test connection"}
              </button>
              <button
                type="button"
                onClick={() => void handleRemoveKey()}
                className="px-4 py-2 rounded-2xl text-sm font-medium text-red-500 hover:bg-red-50 transition-colors"
              >
                Remove key
              </button>
            </div>

            {test.kind === "ok" && (
              <div className="flex items-center gap-2 text-xs text-emerald-600">
                <CheckCircle size={13} />
                Connection successful
              </div>
            )}
            {test.kind === "fail" && (
              <div className="flex items-center gap-2 text-xs text-red-500">
                <XCircle size={13} />
                {test.message}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-stone-400">
              Your key is encrypted locally and never sent to Calmly servers.{" "}
              <a
                href="https://console.anthropic.com/account/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-600 hover:underline"
              >
                Get a key ↗
              </a>
            </p>

            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={keyInput}
                onChange={(e) => {
                  setKeyInput(e.target.value);
                  setSavingKey("idle");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSaveKey();
                }}
                placeholder="sk-ant-api03-…"
                autoComplete="off"
                spellCheck={false}
                className="w-full px-4 py-2.5 pr-10 rounded-2xl border border-stone-200 focus:border-emerald-400 text-sm text-stone-800 bg-stone-50 outline-none transition-colors font-mono placeholder:font-sans placeholder:text-stone-400"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 transition-colors"
              >
                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handleSaveKey()}
                disabled={!keyInput.trim() || savingKey === "saving"}
                className="px-4 py-2 rounded-2xl bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-40 transition-colors flex items-center gap-2"
              >
                {savingKey === "saving" && (
                  <Loader2 size={13} className="animate-spin" />
                )}
                {savingKey === "saving" ? "Saving…" : "Save key"}
              </button>
              {keyState.kind === "editing" && (
                <button
                  type="button"
                  onClick={() => {
                    setKeyState({ kind: "set", last4: "••••" });
                    setKeyInput("");
                  }}
                  className="px-4 py-2 rounded-2xl text-sm font-medium text-stone-500 hover:bg-stone-100 transition-colors"
                >
                  Cancel
                </button>
              )}
              {savingKey === "saved" && (
                <span className="text-xs text-emerald-600 flex items-center gap-1.5">
                  <CheckCircle size={13} /> Saved
                </span>
              )}
              {savingKey === "error" && (
                <span className="text-xs text-red-500 flex items-center gap-1.5">
                  <XCircle size={13} /> Failed to save
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
