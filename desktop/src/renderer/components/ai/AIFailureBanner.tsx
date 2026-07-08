import { useNavigate } from "react-router-dom";
import { AlertCircle, RefreshCw, ExternalLink, X } from "lucide-react";
import type { AIError } from "../../../preload/api-types";

interface AIFailureBannerProps {
  error: AIError;
  onRetry?: () => void;
  onDismiss?: () => void;
}

interface ErrorInfo {
  message: string;
  primaryAction?: {
    label: string;
    action: "retry" | "settings" | "external";
    href?: string;
  };
  secondaryAction?: { label: string; action: "dismiss" | "retry" };
}

function getErrorInfo(error: AIError): ErrorInfo {
  switch (error.kind) {
    case "auth":
      return {
        message: "Your Anthropic key was rejected.",
        primaryAction: { label: "Update key in Settings", action: "settings" },
        secondaryAction: { label: "Dismiss", action: "dismiss" },
      };
    case "quota":
      return {
        message: "Anthropic quota exhausted.",
        primaryAction: {
          label: "See your usage ↗",
          action: "external",
          href: "https://console.anthropic.com/usage",
        },
        secondaryAction: { label: "Dismiss", action: "dismiss" },
      };
    case "network":
      return {
        message: "Couldn't reach Anthropic.",
        primaryAction: { label: "Retry", action: "retry" },
        secondaryAction: { label: "Continue without AI", action: "dismiss" },
      };
    case "timeout":
      return {
        message: "Anthropic took too long.",
        primaryAction: { label: "Retry", action: "retry" },
        secondaryAction: { label: "Continue without AI", action: "dismiss" },
      };
    case "invalid_response":
      return {
        message: "AI returned something unusable.",
        primaryAction: { label: "Retry", action: "retry" },
        secondaryAction: { label: "Dismiss", action: "dismiss" },
      };
    case "unknown":
    default:
      return {
        message: "Something went wrong with AI.",
        primaryAction: { label: "Retry", action: "retry" },
        secondaryAction: { label: "Dismiss", action: "dismiss" },
      };
  }
}

export function AIFailureBanner({
  error,
  onRetry,
  onDismiss,
}: AIFailureBannerProps) {
  const navigate = useNavigate();
  const info = getErrorInfo(error);

  const handlePrimary = () => {
    if (!info.primaryAction) return;
    if (info.primaryAction.action === "retry") onRetry?.();
    else if (info.primaryAction.action === "settings") navigate("/settings/ai");
    else if (
      info.primaryAction.action === "external" &&
      info.primaryAction.href
    ) {
      window.open(info.primaryAction.href, "_blank", "noopener noreferrer");
    }
  };

  const handleSecondary = () => {
    if (!info.secondaryAction) return;
    if (info.secondaryAction.action === "dismiss") onDismiss?.();
    else if (info.secondaryAction.action === "retry") onRetry?.();
  };

  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-2xl border border-rose-200 bg-rose-50/60 px-3 py-2.5"
    >
      <AlertCircle size={13} className="text-rose-500 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-rose-700 font-medium">{info.message}</p>
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          {info.primaryAction && (
            <button
              type="button"
              onClick={handlePrimary}
              className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-800 font-medium underline underline-offset-2 transition-colors"
            >
              {info.primaryAction.action === "retry" && <RefreshCw size={10} />}
              {info.primaryAction.action === "external" && (
                <ExternalLink size={10} />
              )}
              {info.primaryAction.label}
            </button>
          )}
          {info.secondaryAction && (
            <button
              type="button"
              onClick={handleSecondary}
              className="text-xs text-rose-400 hover:text-rose-600 transition-colors"
            >
              {info.secondaryAction.label}
            </button>
          )}
        </div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-rose-300 hover:text-rose-500 transition-colors shrink-0"
          aria-label="Dismiss error"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
