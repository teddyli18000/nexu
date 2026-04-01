import { cn } from "@/lib/utils";
import { X, Zap } from "lucide-react";
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
    iconColor: "text-[#b07d12]",
    textClass: "text-[#7a5a08]",
    upgradeClass: "bg-[#eab308] text-[#3b2f0b] hover:bg-[#dca40a]",
  },
  depleted: {
    titleKey: "budget.banner.depletedTitle",
    descriptionKey: "budget.banner.depletedDescription",
    border: "border-[#f5c6c0]",
    bg: "bg-[linear-gradient(135deg,#fff5f4_0%,#fff0ee_100%)]",
    iconColor: "text-[#d94f3d]",
    textClass: "text-[#9b2c1e]",
    upgradeClass: "bg-[#ff5a3d] text-white hover:bg-[#ed4729]",
  },
} as const;

export function BudgetWarningBanner({
  status,
  onDismiss,
}: BudgetWarningBannerProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const config = statusConfig[status];

  return (
    <div
      className={cn(
        "relative rounded-[18px] border px-5 py-4",
        config.border,
        config.bg,
      )}
    >
      <button
        type="button"
        onClick={onDismiss}
        className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full text-current opacity-50 transition-opacity hover:opacity-80"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>

      <div className="flex flex-col gap-3 pr-6 sm:flex-row sm:items-center sm:gap-5">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div
            className={cn(
              "flex items-center gap-1.5 text-[13px] font-semibold",
              config.textClass,
            )}
          >
            <Zap size={14} className={config.iconColor} />
            {t(config.titleKey)}
          </div>
          <p className={cn("text-[12px] leading-[1.6]", config.textClass)}>
            {t(config.descriptionKey)}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          <div className={cn("text-[11px] font-medium", config.textClass)}>
            {t("budget.banner.actionsLabel")}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate("/workspace/models?tab=providers")}
              className="rounded-lg bg-[#111317] px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-[#1b1f24]"
            >
              {t("budget.banner.apiKey")}
            </button>
            <button
              type="button"
              onClick={() => navigate("/workspace/settings")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[12px] font-medium transition",
                config.upgradeClass,
              )}
            >
              {t("budget.banner.upgrade")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
