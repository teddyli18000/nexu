import { cn } from "@/lib/utils";
import { Cpu, Gift, X, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

export interface BudgetWarningBannerProps {
  status: "warning" | "depleted";
  onDismiss: () => void;
}

const statusConfig = {
  warning: {
    titleKey: "budget.banner.warningTitle",
    descriptionKey: "budget.banner.warningDescription",
    border: "border-[#f5dfa0]",
    bg: "bg-[linear-gradient(135deg,#fffbec_0%,#fff8dc_100%)]",
    textClass: "text-[#7a5a08]",
    taskClass: "bg-[#eab308] text-[#3b2f0b] hover:bg-[#dca40a]",
  },
  depleted: {
    titleKey: "budget.banner.depletedTitle",
    descriptionKey: "budget.banner.depletedDescription",
    border: "border-[#f5c6c0]",
    bg: "bg-[linear-gradient(135deg,#fff5f4_0%,#fff0ee_100%)]",
    textClass: "text-[#9b2c1e]",
    taskClass: "bg-[#ff5a3d] text-white hover:bg-[#ed4729]",
  },
} as const;

export function BudgetWarningBanner({
  status,
  onDismiss,
}: BudgetWarningBannerProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const config = statusConfig[status];
  const accentColor =
    status === "depleted" ? "var(--color-danger)" : "var(--color-warning)";
  const buttonClass =
    "inline-flex items-center justify-center gap-1.5 rounded-[8px] px-[14px] py-[5px] text-[12px] font-medium transition-colors";

  return (
    <div
      className={cn(
        "relative rounded-xl border px-5 py-4",
        config.border,
        config.bg,
      )}
    >
      <button
        type="button"
        onClick={onDismiss}
        className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-black/8 hover:text-text-secondary"
        aria-label="Dismiss"
      >
        <X size={12} />
      </button>

      <div className="pr-4">
        <div className="flex items-start gap-3">
          <div
            className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]"
            style={{
              background: `color-mix(in srgb, ${accentColor} 15%, transparent)`,
            }}
          >
            <Zap size={14} style={{ color: accentColor }} />
          </div>
          <div
            className={cn(
              "pt-[3px] text-[13px] font-semibold",
              config.textClass,
            )}
          >
            {t(config.titleKey)}
          </div>
        </div>

        <div className="mt-3 pl-10">
          <p className={cn("text-[12px] leading-[1.6]", config.textClass)}>
            {t(config.descriptionKey)}
          </p>
          <div className="mb-1.5 mt-3 text-[11px] text-text-tertiary">
            {t("budget.banner.actionsLabel")}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => navigate("/workspace/rewards")}
              className={cn(buttonClass, config.taskClass)}
            >
              <Gift size={12} />
              {t("budget.banner.earnCredits")}
            </button>
            <button
              type="button"
              onClick={() => navigate("/workspace/models?tab=providers")}
              className={cn(
                buttonClass,
                "border border-border bg-white text-text-secondary hover:bg-surface-1",
              )}
            >
              <Cpu size={12} />
              {t("budget.banner.byok")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
