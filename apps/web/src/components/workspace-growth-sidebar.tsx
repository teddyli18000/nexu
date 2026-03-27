import type { BudgetState } from "@/hooks/use-budget";
import { track } from "@/lib/tracking";
import { cn } from "@/lib/utils";
import { ChevronRight, Gift, Zap } from "lucide-react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { NavigateFunction } from "react-router-dom";

function formatRewardAmount(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

export function WorkspaceGrowthSidebar({
  budget,
  isLoggedIn,
  navigate,
  showBudgetPanel,
  setShowBudgetPanel,
  budgetPanelRef,
}: {
  budget: BudgetState;
  isLoggedIn: boolean;
  navigate: NavigateFunction;
  showBudgetPanel: boolean;
  setShowBudgetPanel: (v: boolean) => void;
  budgetPanelRef: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  const mergedTotal = budget.total + budget.bonusTotal;
  const mergedRemaining = budget.remaining + budget.bonusRemaining;
  const mergedPct =
    mergedTotal > 0 ? Math.round((mergedRemaining / mergedTotal) * 100) : 0;
  const mergedUsed = mergedTotal - mergedRemaining;

  const goRewards = () => {
    track("workspace_growth_rewards_click", { logged_in: isLoggedIn });
    if (isLoggedIn) navigate("/workspace/rewards");
    else navigate("/");
  };

  const hasRewardProgress = budget.claimedCount < budget.channelCount;
  const showGiftBanner = isLoggedIn || hasRewardProgress;

  return (
    <>
      {showGiftBanner && (
        <button
          type="button"
          onClick={goRewards}
          className="mx-3 mb-2 flex items-center gap-3 px-3.5 py-3 rounded-[12px] bg-gradient-to-br from-[#FFF8F0] via-[#FFFAF5] to-[#FFF5EB] border border-[#F5DFC0]/50 shadow-[0_1px_3px_rgba(245,200,120,0.08)] hover:shadow-[0_2px_8px_rgba(245,200,120,0.15)] hover:border-[#F0D0A0]/60 transition-all duration-200 group cursor-pointer"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <div className="w-7 h-7 rounded-[8px] bg-gradient-to-br from-amber-400 to-orange-400 flex items-center justify-center shrink-0 shadow-[0_1px_3px_rgba(245,158,11,0.25)]">
            <Gift size={14} className="text-white" />
          </div>
          {isLoggedIn ? (
            <>
              <span className="flex-1 text-[12px] font-medium text-text-primary leading-none truncate">
                {hasRewardProgress
                  ? t("budget.viral.title")
                  : t("budget.viral.allComplete")}
              </span>
              <span className="text-[11px] text-text-tertiary tabular-nums shrink-0">
                {budget.claimedCount}/{budget.channelCount}
              </span>
            </>
          ) : (
            <span className="flex-1 text-[12px] font-medium text-text-primary leading-[1.4] text-left">
              {t("budget.viral.loginFirst")}
            </span>
          )}
          <ChevronRight
            size={14}
            className="text-text-muted shrink-0 group-hover:translate-x-0.5 transition-transform duration-200"
          />
        </button>
      )}

      {isLoggedIn && (
        <div
          className="relative px-3 mb-1.5"
          ref={budgetPanelRef}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <button
            type="button"
            onClick={() => setShowBudgetPanel(!showBudgetPanel)}
            className="w-full px-2.5 py-2 rounded-[8px] hover:bg-surface-2 transition-colors cursor-pointer group"
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <Zap
                  size={12}
                  className={
                    budget.status === "healthy"
                      ? "text-[var(--color-success)]"
                      : budget.status === "warning"
                        ? "text-[var(--color-warning)]"
                        : "text-[var(--color-danger)]"
                  }
                />
                <span className="text-[12px] font-medium text-text-secondary tabular-nums">
                  ${mergedRemaining.toFixed(2)} / ${mergedTotal.toFixed(2)}
                </span>
              </div>
              <span className="text-[10px] text-text-muted">
                {budget.resetsInDays === 1
                  ? t("budget.resetsIn1")
                  : t("budget.resetsIn").replace(
                      "{n}",
                      String(budget.resetsInDays),
                    )}
              </span>
            </div>
            <div className="h-[4px] w-full rounded-full bg-border overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  budget.status === "healthy" && "bg-[var(--color-success)]",
                  budget.status === "warning" && "bg-[var(--color-warning)]",
                  budget.status === "depleted" && "bg-[var(--color-danger)]",
                )}
                style={{ width: `${mergedPct}%` }}
              />
            </div>
          </button>

          {showBudgetPanel && (
            <div
              className="absolute z-30 bottom-full left-3 right-3 mb-2 rounded-xl border bg-surface-1 border-border overflow-hidden"
              style={{ boxShadow: "var(--shadow-dropdown)" }}
            >
              <div className="p-3">
                <div className="text-[12px] font-medium text-text-primary mb-3">
                  {t("budget.label")}
                </div>

                <div className="space-y-2.5">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className="text-[11px] text-text-secondary cursor-help border-b border-dashed border-text-muted/30"
                        title={
                          budget.resetsInDays === 1
                            ? t("budget.cycleTooltip1")
                            : t("budget.cycleTooltip").replace(
                                "{n}",
                                String(budget.resetsInDays),
                              )
                        }
                      >
                        {t("budget.cycle")}
                      </span>
                      <span className="text-[11px] font-medium tabular-nums text-text-primary">
                        ${mergedUsed.toFixed(2)} / ${mergedTotal.toFixed(2)}
                      </span>
                    </div>
                    <div className="h-[6px] w-full rounded-full bg-border overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-500",
                          budget.status === "healthy" &&
                            "bg-[var(--color-success)]",
                          budget.status === "warning" &&
                            "bg-[var(--color-warning)]",
                          budget.status === "depleted" &&
                            "bg-[var(--color-danger)]",
                        )}
                        style={{
                          width: `${mergedTotal > 0 ? (mergedUsed / mergedTotal) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    {budget.bonusTotal > 0 && (
                      <div className="flex items-center gap-1 mt-1.5 text-[10px] text-[var(--color-success)]">
                        <Gift size={10} />
                        <span>
                          {t("budget.bonusIncluded").replace(
                            "${n}",
                            budget.bonusRemaining.toFixed(2),
                          )}
                        </span>
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className="text-[11px] text-text-secondary cursor-help border-b border-dashed border-text-muted/30"
                        title={
                          budget.windowResetsInHours === 0
                            ? t("budget.windowTooltip0")
                            : t("budget.windowTooltip").replace(
                                "{n}",
                                String(budget.windowResetsInHours),
                              )
                        }
                      >
                        {t("budget.window")}
                      </span>
                      <span className="text-[11px] font-medium tabular-nums text-text-primary">
                        ${budget.windowUsed.toFixed(2)} / $
                        {budget.windowLimit.toFixed(2)}
                      </span>
                    </div>
                    <div className="h-[6px] w-full rounded-full bg-border overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[var(--color-info)] transition-all duration-500"
                        style={{
                          width: `${(budget.windowUsed / budget.windowLimit) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setShowBudgetPanel(false);
                    goRewards();
                  }}
                  className="mt-3 pt-3 border-t border-border flex items-center gap-2 w-full group"
                >
                  <Gift size={12} className="text-amber-500 shrink-0" />
                  <span className="text-[11px] text-text-secondary flex-1 text-left tabular-nums">
                    {budget.claimedCount}/{budget.channelCount} · $
                    {formatRewardAmount(budget.totalRewardClaimed)}
                  </span>
                  <ChevronRight
                    size={12}
                    className="text-text-muted group-hover:text-text-secondary transition-colors shrink-0"
                  />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
