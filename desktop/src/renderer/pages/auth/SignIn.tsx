import { useState, useEffect, type FormEvent } from "react";
import { DEFAULT_SERVER_URL } from "@calmly/shared";
import { MountainClimberIcon } from "../../components/MountainClimberIcon";
import { useAuth } from "../../auth/AuthContext";
import type { RequestLinkResult } from "../../../preload/api-types";

type Phase =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; email: string }
  | {
      kind: "error";
      reason: "invalid_email" | "rate_limited" | "network" | "server";
    };

const ERROR_COPY: Record<
  Exclude<
    Phase,
    { kind: "idle" } | { kind: "sending" } | { kind: "sent" }
  >["reason"],
  { title: string; body: string }
> = {
  invalid_email: {
    title: "That email doesn't look right",
    body: "Double-check the address and try again.",
  },
  rate_limited: {
    title: "Too many attempts",
    body: "Give it a few minutes before sending another link.",
  },
  network: {
    title: "Couldn't reach the sign-in service",
    body: "Check your connection and try again.",
  },
  server: {
    title: "Something went wrong on our end",
    body: "Try again in a moment.",
  },
};

const REDEEM_COPY: Record<
  "invalid_or_expired" | "invalid_request" | "network" | "server",
  { title: string; body: string }
> = {
  invalid_or_expired: {
    title: "That link expired",
    body: "Sign-in links are good for 15 minutes. Send a fresh one below.",
  },
  invalid_request: {
    title: "That link looks malformed",
    body: "Try sending a new link below.",
  },
  network: {
    title: "Couldn't finish signing in",
    body: "Check your connection, then click the most recent link or send a new one.",
  },
  server: {
    title: "Sign-in didn't complete",
    body: "Try sending a new link below.",
  },
};

export function SignIn() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  // Surface a banner above the form when the most recent deep-link redeem
  // failed or the user just signed out. The banner is purely informational —
  // it does not gate the form.
  const banner =
    auth.state.status === "signed_out" ? auth.state.banner : undefined;

  const [activeServerUrl, setActiveServerUrl] = useState<string | null>(null);
  useEffect(() => {
    window.calmly.settings
      .getSyncServerUrl()
      .then((url) => {
        setActiveServerUrl(url !== DEFAULT_SERVER_URL ? url : null);
      })
      .catch(() => {
        /* ignore */
      });
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (phase.kind === "sending") return;
    setPhase({ kind: "sending" });
    const result: RequestLinkResult = await auth.requestLink(email);
    if (result.ok) {
      // Anti-enumeration: the server returns 200 whether or not the address
      // has an account. We mirror that here — the user always sees the same
      // confirmation. Real users get a real link in their inbox; bots or
      // typos get nothing, but with no signal from us either way.
      setPhase({ kind: "sent", email: email.trim() });
      return;
    }
    setPhase({ kind: "error", reason: result.error });
  }

  function reset() {
    setPhase({ kind: "idle" });
  }

  return (
    <div className="min-h-screen bg-[#F9F7F2] text-stone-800 font-sans selection:bg-emerald-100 flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <header className="flex flex-col items-center text-center mb-12">
          <div className="w-16 h-16 bg-stone-900 rounded-[1.8rem] flex items-center justify-center shadow-lg mb-6">
            <MountainClimberIcon className="w-10 h-10 text-white" />
          </div>
          <h1 className="font-serif italic text-4xl tracking-tight text-stone-800">
            Welcome to Calmly.
          </h1>
          <p className="mt-3 text-sm text-stone-500 tracking-wide max-w-xs">
            Sign in with your email. We'll send you a link — no password to
            remember.
          </p>
          {activeServerUrl && (
            <p className="mt-2 text-[11px] text-stone-400 tracking-wide">
              Connecting to: {activeServerUrl}
            </p>
          )}
        </header>

        {banner && banner.kind === "redeem-failed" ? (
          <Banner
            tone="warn"
            title={REDEEM_COPY[banner.reason].title}
            body={REDEEM_COPY[banner.reason].body}
          />
        ) : null}
        {banner && banner.kind === "signed-out" ? (
          <Banner
            tone="info"
            title="You're signed out"
            body="Sign in again whenever you're ready."
          />
        ) : null}

        {phase.kind === "sent" ? (
          <SentConfirmation email={phase.email} onReset={reset} />
        ) : (
          <form
            onSubmit={onSubmit}
            className="bg-white border border-stone-100 rounded-[2rem] shadow-sm p-8"
            aria-busy={phase.kind === "sending"}
          >
            <label
              htmlFor="email"
              className="block text-[10px] font-bold tracking-[0.2em] uppercase text-stone-500 mb-3"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (phase.kind === "error") setPhase({ kind: "idle" });
              }}
              placeholder="you@example.com"
              required
              className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 text-stone-800 placeholder:text-stone-400 outline-none focus:border-emerald-300 focus:bg-white transition-colors"
            />

            {phase.kind === "error" ? (
              <p role="alert" className="mt-3 text-xs text-rose-600">
                <span className="font-semibold">
                  {ERROR_COPY[phase.reason].title}
                </span>
                {" — "}
                {ERROR_COPY[phase.reason].body}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={phase.kind === "sending" || email.trim().length === 0}
              className={[
                "mt-6 w-full px-4 py-3 rounded-2xl text-sm font-medium tracking-wide transition-colors",
                phase.kind === "sending" || email.trim().length === 0
                  ? "bg-stone-100 text-stone-400 cursor-not-allowed"
                  : "bg-emerald-500 text-white hover:bg-emerald-600 shadow-sm",
              ].join(" ")}
            >
              {phase.kind === "sending" ? "Sending link…" : "Send sign-in link"}
            </button>

            <p className="mt-6 text-[11px] text-stone-400 leading-relaxed text-center">
              Sign-in links last 15 minutes. We'll never email you anything
              else.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

interface SentConfirmationProps {
  email: string;
  onReset: () => void;
}

function SentConfirmation({ email, onReset }: SentConfirmationProps) {
  return (
    <div className="bg-white border border-stone-100 rounded-[2rem] shadow-sm p-8 text-center">
      <div className="mx-auto w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-5">
        {/* Simple inline check; matches the calm/anti-flashy tone. */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className="w-6 h-6"
        >
          <path
            d="M5 12.5l4 4 10-10"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h2 className="font-serif italic text-2xl text-stone-800">
        Check your email.
      </h2>
      <p className="mt-3 text-sm text-stone-500 tracking-wide">
        We sent a sign-in link to{" "}
        <span className="font-medium text-stone-700">{email}</span>. Click it to
        finish signing in.
      </p>
      <button
        type="button"
        onClick={onReset}
        className="mt-8 text-xs text-stone-500 hover:text-emerald-600 underline-offset-4 hover:underline transition-colors"
      >
        Use a different email
      </button>
    </div>
  );
}

interface BannerProps {
  tone: "warn" | "info";
  title: string;
  body: string;
}

function Banner({ tone, title, body }: BannerProps) {
  const palette =
    tone === "warn"
      ? "bg-rose-50 border-rose-100 text-rose-800"
      : "bg-stone-50 border-stone-200 text-stone-700";
  return (
    <div
      role="status"
      className={`mb-6 rounded-2xl border px-5 py-4 ${palette}`}
    >
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs opacity-80">{body}</p>
    </div>
  );
}
