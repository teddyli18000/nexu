import { useBotQuota } from "@/hooks/use-bot-quota";
import {
  REWARD_CHANNELS,
  type RewardChannel,
  type RewardGroup,
  useBudget,
} from "@/hooks/use-budget";
import { cn } from "@/lib/utils";
import { Check, Download, Gift } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const REWARD_GROUPS: { key: RewardGroup; labelKey: string }[] = [
  { key: "daily", labelKey: "rewards.group.daily" },
  { key: "opensource", labelKey: "rewards.group.opensource" },
  { key: "social", labelKey: "rewards.group.social" },
  { key: "messaging", labelKey: "rewards.group.messaging" },
];

export function formatRewardAmount(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

function downloadShareCard() {
  const W = 1080;
  const H = 1080;
  const PAD = 80;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#f8fafc");
  grad.addColorStop(1, "#e2e8f0");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 64px system-ui, -apple-system, sans-serif";
  ctx.fillText("nexu", PAD, 160);

  ctx.fillStyle = "#475569";
  ctx.font = "32px system-ui, -apple-system, sans-serif";
  ctx.fillText("Open-source OpenClaw desktop", PAD, 220);

  ctx.fillStyle = "#64748b";
  ctx.font = "28px system-ui, -apple-system, sans-serif";
  const lines = [
    "Bridge your agent to Feishu, Slack,",
    "Discord & more.",
    "",
    "BYOK, OAuth, local-first.",
  ];
  let y = 320;
  for (const line of lines) {
    if (line) ctx.fillText(line, PAD, y);
    y += 42;
  }

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 28px system-ui, -apple-system, sans-serif";
  ctx.fillText("github.com/nexu-io/nexu", PAD, H - 120);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "24px system-ui, -apple-system, sans-serif";
  ctx.fillText("Star ⭐ & try it free", PAD, H - 76);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nexu-share.png";
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

function ChannelIcon({ icon, size = 16 }: { icon: string; size?: number }) {
  switch (icon) {
    case "github":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="#181717">
          <title>GitHub</title>
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
        </svg>
      );
    case "x":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="#000000">
          <title>X</title>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      );
    case "reddit":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="#FF4500">
          <title>Reddit</title>
          <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 0-.463.327.327 0 0 0-.462 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.231-.094z" />
        </svg>
      );
    case "calendar":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#F59E0B"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <title>Calendar</title>
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
          <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
        </svg>
      );
    case "xiaohongshu":
    case "lingying":
    case "jike":
    case "wechat":
    case "feishu":
      return <Gift size={size} className="text-text-secondary" />;
    default:
      return <Gift size={size} />;
  }
}

function RewardConfirmModal({
  channel,
  onConfirm,
  onCancel,
}: {
  channel: RewardChannel;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const isDaily = channel.repeatable === "daily";
  const isImage = channel.shareMode === "image";
  const [imageDownloaded, setImageDownloaded] = useState(false);

  const descKey = isDaily
    ? "budget.confirm.checkinDesc"
    : isImage
      ? "budget.confirm.imageDesc"
      : channel.requiresScreenshot
        ? "budget.confirm.screenshotDesc"
        : "budget.confirm.desc";
  const amt = formatRewardAmount(channel.reward);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        aria-label={t("budget.confirm.cancel")}
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
        onClick={onCancel}
      />
      <div className="relative w-full max-w-[340px] mx-4 rounded-2xl border border-border bg-white shadow-[var(--shadow-dropdown)] p-5">
        <div className="flex flex-col items-center text-center">
          <div
            className={cn(
              "w-11 h-11 rounded-xl flex items-center justify-center mb-4",
              isDaily
                ? "bg-amber-50 border border-amber-200/60"
                : "bg-[var(--color-success)]/8 border border-[var(--color-success)]/20",
            )}
          >
            <ChannelIcon icon={channel.icon} size={22} />
          </div>
          <h3 className="text-[14px] font-semibold text-text-primary mb-1">
            {t("budget.confirm.title").replace(
              "{channel}",
              t(`reward.${channel.id}.name`),
            )}
          </h3>
          <p className="text-[12px] text-text-secondary leading-relaxed mb-1">
            {t(descKey).replace("${n}", amt)}
          </p>
          <div className="inline-flex items-center px-3 py-1 rounded-full bg-[var(--color-success)]/8 text-[13px] font-semibold text-[var(--color-success)] mb-4 tabular-nums leading-none">
            +${amt}
          </div>

          {isImage && !imageDownloaded && (
            <button
              type="button"
              onClick={() => {
                downloadShareCard();
                setImageDownloaded(true);
              }}
              className="flex items-center justify-center gap-2 w-full h-[36px] rounded-[10px] bg-[var(--color-brand-primary)] text-white text-[13px] font-medium hover:opacity-90 active:scale-[0.98] transition-all mb-3"
            >
              <Download size={14} />
              {t("budget.confirm.downloadImage")}
            </button>
          )}
          {isImage && imageDownloaded && (
            <div className="flex items-center gap-1.5 text-[12px] text-[var(--color-success)] font-medium mb-3">
              <Check size={14} />
              {t("budget.confirm.downloadImage")} ✓
            </div>
          )}

          <div className="flex items-center gap-2 w-full">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 h-[36px] rounded-[10px] border border-border text-[13px] font-medium text-text-secondary hover:bg-surface-2 transition-colors"
            >
              {t("budget.confirm.cancel")}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="flex-1 h-[36px] rounded-[10px] bg-neutral-900 text-white text-[13px] font-medium hover:bg-neutral-800 active:scale-[0.98] transition-all"
            >
              {t("budget.confirm.done")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function WorkspaceRewardsPage() {
  const { t } = useTranslation();
  const { available: quotaAvailable } = useBotQuota();
  const budget = useBudget(quotaAvailable ? "healthy" : "depleted");
  const [rewardConfirm, setRewardConfirm] = useState<RewardChannel | null>(
    null,
  );

  const allTasks = REWARD_CHANNELS;
  const completedCount =
    budget.claimedCount + (budget.dailyCheckedInToday ? 1 : 0);
  const totalCount = budget.channelCount + 1;

  const handleClaimChannel = (ch: RewardChannel) => {
    if (ch.repeatable === "daily") {
      budget.claimChannel("daily_checkin");
      return;
    }
    if (ch.shareMode === "image") {
      setRewardConfirm(ch);
      return;
    }
    if (ch.requiresScreenshot) {
      setRewardConfirm(ch);
      return;
    }
    if (ch.url) window.open(ch.url, "_blank", "noopener,noreferrer");
    setRewardConfirm(ch);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-[520px] mx-auto">
        <div className="mb-6">
          <h1 className="text-[22px] font-bold text-text-primary mb-1">
            {t("rewards.title")}
          </h1>
          <p className="text-[13px] text-text-secondary">
            {t("rewards.desc")}{" "}
            <a
              href="https://docs.nexu.io/rewards"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-link)] hover:underline"
            >
              {t("budget.viral.rules")}
            </a>
          </p>
        </div>

        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] font-medium text-text-secondary tabular-nums">
              {completedCount} / {totalCount}
            </span>
            <span className="text-[12px] font-medium text-[var(--color-success)] tabular-nums">
              +${formatRewardAmount(budget.totalRewardClaimed)}
            </span>
          </div>
          <div className="h-[5px] w-full rounded-full bg-border/60 overflow-hidden">
            <div
              className="h-full rounded-full bg-[var(--color-success)] transition-all duration-500"
              style={{
                width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%`,
              }}
            />
          </div>
        </div>

        <div className="space-y-4">
          {REWARD_GROUPS.map((group) => {
            const channels = allTasks.filter((c) => c.group === group.key);
            if (channels.length === 0) return null;
            return (
              <div key={group.key}>
                <div className="text-[11px] font-semibold text-text-tertiary uppercase tracking-widest mb-1.5 pl-0.5">
                  {t(group.labelKey)}
                </div>
                <div className="space-y-0.5">
                  {channels.map((ch) => {
                    const isDaily = ch.repeatable === "daily";
                    const done = isDaily
                      ? budget.dailyCheckedInToday
                      : budget.claimedChannels.has(ch.id);

                    const ctaLabel = done
                      ? t("budget.cta.done").replace(
                          "${n}",
                          formatRewardAmount(ch.reward),
                        )
                      : isDaily
                        ? t("budget.cta.checkin")
                        : ch.shareMode === "image"
                          ? t("budget.cta.download")
                          : ch.shareMode === "tweet"
                            ? t("budget.cta.share")
                            : t("budget.cta.go");

                    return (
                      <div
                        key={ch.id}
                        className="flex items-center gap-3 rounded-lg px-3 py-3"
                      >
                        <div
                          className={cn(
                            "w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 transition-colors",
                            done
                              ? "bg-surface-2 border border-border/50 opacity-50"
                              : "bg-white border border-border",
                          )}
                        >
                          <ChannelIcon icon={ch.icon} size={16} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                "text-[13px] font-medium leading-tight",
                                done ? "text-text-muted" : "text-text-primary",
                              )}
                            >
                              {t(`reward.${ch.id}.name`)}
                            </span>
                            <span className="text-[11px] font-semibold tabular-nums leading-none text-[var(--color-success)]">
                              +${formatRewardAmount(ch.reward)}
                            </span>
                          </div>
                          <div
                            className={cn(
                              "text-[11px] mt-0.5",
                              done ? "text-text-muted/60" : "text-text-muted",
                            )}
                          >
                            {t(`reward.${ch.id}.desc`)}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={done}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (done) return;
                            handleClaimChannel(ch);
                          }}
                          className={cn(
                            "shrink-0 inline-flex items-center justify-center rounded-full h-[26px] px-3 text-[12px] font-medium transition-all leading-none",
                            done
                              ? "text-[var(--color-success)] bg-[var(--color-success)]/8"
                              : "text-[var(--color-brand-primary)] border border-[var(--color-brand-primary)]/30 hover:bg-[var(--color-brand-primary)]/5 active:scale-[0.97] cursor-pointer",
                          )}
                        >
                          {ctaLabel}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {budget.dailyCheckinBonusTotal > 0 && (
          <div className="mt-5 pt-4 border-t border-border/50 text-[11px] text-text-muted">
            {t("rewards.checkinTotal").replace(
              "${n}",
              formatRewardAmount(budget.dailyCheckinBonusTotal),
            )}
          </div>
        )}
      </div>

      {rewardConfirm && (
        <RewardConfirmModal
          channel={rewardConfirm}
          onCancel={() => setRewardConfirm(null)}
          onConfirm={() => {
            budget.claimChannel(rewardConfirm.id);
            setRewardConfirm(null);
          }}
        />
      )}
    </div>
  );
}
