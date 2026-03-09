import { BrandMark } from "@/components/brand-mark";
import { SlackOAuthView } from "@/components/channel-setup/slack-oauth-view";
import { authClient } from "@/lib/auth-client";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import "@/lib/api";
import {
  getApiV1ChannelsSlackClaimInfo,
  postApiV1ChannelsSlackClaim,
} from "../../lib/api/sdk.gen";

type ClaimInfo = {
  valid: boolean;
  expired: boolean;
  used: boolean;
  teamName: string | null;
  memberCount: number;
  isExistingWorkspace: boolean;
};

type ClaimResult = {
  success: boolean;
  teamName: string | null;
  botId: string;
  slackTeamId: string;
};

const CLAIM_CONTEXT_STORAGE_KEY = "nexu_claim_context";
const CLAIM_TOKEN_STORAGE_KEY = "nexu_claim_token";

const CAPABILITY_PILLS = [
  { emoji: "\u{1F4BB}", label: "Code & Deploy" },
  { emoji: "\u{1F4CA}", label: "Data Analysis" },
  { emoji: "\u270D\uFE0F", label: "Content" },
];

function ClaimErrorState({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface-1 p-6 text-center">
        <h1 className="text-[20px] font-bold text-text-primary">{title}</h1>
        <p className="mt-2 text-[13px] text-text-secondary">{desc}</p>
        <Link
          to="/auth"
          className="mt-5 inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-fg"
        >
          Go to Nexu
        </Link>
      </div>
    </div>
  );
}

export function ClaimPage() {
  const [searchParams] = useSearchParams();
  const { data: session, isPending } = authClient.useSession();
  const token = searchParams.get("token") ?? "";
  const slackConnected = searchParams.get("slackConnected") === "true";
  const [claimInfo, setClaimInfo] = useState<ClaimInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [claimResult, setClaimResult] = useState<ClaimResult | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const claimRequestedRef = useRef(false);

  useEffect(() => {
    if (!token) {
      setLoadingInfo(false);
      return;
    }
    let cancelled = false;
    setLoadingInfo(true);
    getApiV1ChannelsSlackClaimInfo({ query: { token } })
      .then(({ data }) => {
        if (cancelled) return;
        setClaimInfo(
          data ?? {
            valid: false,
            expired: false,
            used: false,
            teamName: null,
            memberCount: 0,
            isExistingWorkspace: false,
          },
        );
      })
      .catch(() => {
        if (cancelled) return;
        setClaimInfo({
          valid: false,
          expired: false,
          used: false,
          teamName: null,
          memberCount: 0,
          isExistingWorkspace: false,
        });
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingInfo(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const performClaim = useCallback(async () => {
    if (!token || claimRequestedRef.current) return;
    claimRequestedRef.current = true;
    setClaiming(true);
    setClaimError(null);
    try {
      const { data, error } = await postApiV1ChannelsSlackClaim({
        body: { claimToken: token },
      });
      if (error || !data?.success) {
        setClaimError(error?.message ?? "Failed to claim workspace");
        return;
      }
      setClaimResult(data);
      sessionStorage.setItem(
        CLAIM_CONTEXT_STORAGE_KEY,
        JSON.stringify({
          teamName: data.teamName,
          slackTeamId: data.slackTeamId,
          botId: data.botId,
          claimedAt: new Date().toISOString(),
        }),
      );
      sessionStorage.removeItem(CLAIM_TOKEN_STORAGE_KEY);
    } catch {
      setClaimError("Failed to claim workspace");
    } finally {
      setClaiming(false);
    }
  }, [token]);

  useEffect(() => {
    claimRequestedRef.current = false;
    setClaimResult(null);
    setClaimError(null);
  }, []);

  useEffect(() => {
    if (!claimInfo?.valid || claimInfo.expired || claimInfo.used) return;
    if (!session?.user) return;

    if (claimInfo.isExistingWorkspace) {
      void performClaim();
      return;
    }

    if (slackConnected) {
      void performClaim();
    }
  }, [claimInfo, session?.user, slackConnected, performClaim]);

  const authLinkBase = useMemo(() => {
    const params = new URLSearchParams({
      source: "IM",
      claimToken: token,
    });
    return params.toString();
  }, [token]);

  if (!token) {
    return (
      <ClaimErrorState
        title="Invalid claim link"
        desc="This link is missing the claim token. Please open the latest link from Slack."
      />
    );
  }

  if (loadingInfo || isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (!claimInfo?.valid) {
    return (
      <ClaimErrorState
        title={claimInfo?.expired ? "Claim link expired" : "Invalid claim link"}
        desc="Please request a new claim link from Slack and try again."
      />
    );
  }

  if (claimInfo.used) {
    return (
      <ClaimErrorState
        title="Claim link already used"
        desc="This Slack account has already been linked. If this is unexpected, contact support."
      />
    );
  }

  if (claimError) {
    return (
      <ClaimErrorState title="Unable to complete claim" desc={claimError} />
    );
  }

  if (claimResult?.success) {
    const teamId = claimResult.slackTeamId;
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-lg rounded-xl border border-border bg-surface-1 p-6 text-center">
          <h1 className="text-[22px] font-bold text-text-primary">
            Slack connected to Nexu
          </h1>
          <p className="mt-2 text-[13px] text-text-secondary">
            {claimResult.teamName
              ? `Workspace "${claimResult.teamName}" is ready.`
              : "Your workspace is ready."}
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <a
              href={`https://app.slack.com/client/${teamId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-fg"
            >
              Open Slack
            </a>
            <Link
              to="/workspace"
              className="inline-flex items-center justify-center rounded-lg border border-border px-4 py-2 text-[13px] font-medium text-text-primary"
            >
              Continue exploring Nexu
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (session?.user) {
    if (claiming) {
      return (
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
        </div>
      );
    }

    if (!claimInfo.isExistingWorkspace) {
      return (
        <div className="flex min-h-screen">
          <div className="hidden w-[420px] shrink-0 flex-col justify-between bg-[#111111] p-8 lg:flex">
            <div className="flex items-center gap-2.5">
              <BrandMark className="h-7 w-7 shrink-0" />
              <span className="text-[14px] font-semibold text-white/90">
                Nexu
              </span>
            </div>
            <div>
              <h2 className="mb-4 text-[30px] font-bold leading-[1.15] text-white">
                Set up Nexu for
                <br />
                your workspace.
              </h2>
              <p className="mb-6 max-w-[280px] text-[13px] leading-relaxed text-white/45">
                Connect Slack once, then your team can collaborate with Nexu
                immediately.
              </p>
              <div className="flex flex-wrap gap-2">
                {CAPABILITY_PILLS.map((pill) => (
                  <span
                    key={pill.label}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.07] px-3 py-1.5 text-[12px] font-medium text-white/60"
                  >
                    <span className="text-[11px]">{pill.emoji}</span>
                    {pill.label}
                  </span>
                ))}
              </div>
            </div>
            <div className="text-[11px] text-white/20">
              &copy; 2026 Nexu by Refly
            </div>
          </div>
          <div className="flex flex-1 items-center justify-center px-4 py-8 sm:px-6 sm:py-12">
            <div className="w-full max-w-[640px]">
              <h1 className="mb-2 text-[22px] font-bold text-text-primary">
                Connect your Slack workspace
              </h1>
              <p className="mb-6 text-[13px] text-text-secondary">
                Complete Slack authorization to finish your claim.
              </p>
              <SlackOAuthView
                onConnected={() => {
                  toast.success("Slack connected, finalizing claim...");
                  void performClaim();
                }}
                oauthReturnTo={`/claim?token=${encodeURIComponent(token)}`}
              />
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <div className="hidden w-[420px] shrink-0 flex-col justify-between bg-[#111111] p-8 lg:flex">
        <div className="flex items-center gap-2.5">
          <BrandMark className="h-7 w-7 shrink-0" />
          <span className="text-[14px] font-semibold text-white/90">Nexu</span>
        </div>
        <div>
          {claimInfo.isExistingWorkspace ? (
            <>
              <h2 className="mb-4 text-[30px] font-bold leading-[1.15] text-white">
                Your team already
                <br />
                uses Nexu.
              </h2>
              <p className="text-[13px] leading-relaxed text-white/45">
                {claimInfo.teamName
                  ? `${claimInfo.teamName} already has Nexu enabled.`
                  : "Your workspace already has Nexu enabled."}{" "}
                {claimInfo.memberCount > 0
                  ? `${claimInfo.memberCount} member${claimInfo.memberCount > 1 ? "s are" : " is"} linked.`
                  : ""}
              </p>
            </>
          ) : (
            <>
              <h2 className="mb-4 text-[30px] font-bold leading-[1.15] text-white">
                Launch Nexu for
                <br />
                your team.
              </h2>
              <p className="mb-6 max-w-[280px] text-[13px] leading-relaxed text-white/45">
                Create your account first, then complete Slack setup in one
                flow.
              </p>
              <div className="flex flex-wrap gap-2">
                {CAPABILITY_PILLS.map((pill) => (
                  <span
                    key={pill.label}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.07] px-3 py-1.5 text-[12px] font-medium text-white/60"
                  >
                    <span className="text-[11px]">{pill.emoji}</span>
                    {pill.label}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="text-[11px] text-white/20">
          &copy; 2026 Nexu by Refly
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center bg-surface-0 px-4 py-8 sm:px-6 sm:py-12">
        <div className="w-full max-w-[380px] rounded-xl border border-border bg-surface-1 p-6">
          {claimInfo.isExistingWorkspace && (
            <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-[12px] text-emerald-700">
              Your team is already connected — no Slack config needed.
            </div>
          )}
          <h1 className="text-[22px] font-bold text-text-primary">
            Create your Nexu account
          </h1>
          <p className="mt-1 text-[13px] text-text-secondary">
            Continue with sign up or log in to claim this Slack workspace.
          </p>
          <div className="mt-6 space-y-3">
            <Link
              to={`/auth?mode=signup&${authLinkBase}`}
              className="inline-flex w-full items-center justify-center rounded-lg bg-accent px-4 py-2.5 text-[13px] font-medium text-accent-fg"
            >
              Register
            </Link>
            <Link
              to={`/auth?${authLinkBase}`}
              className="inline-flex w-full items-center justify-center rounded-lg border border-border px-4 py-2.5 text-[13px] font-medium text-text-primary"
            >
              Log in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
