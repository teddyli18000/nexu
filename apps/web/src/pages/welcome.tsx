import { ProviderLogo } from "@/components/provider-logo";
import { ArrowRight, Key, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

const SETUP_COMPLETE_KEY = "nexu_setup_complete";

function isSetupComplete(): boolean {
  return localStorage.getItem(SETUP_COMPLETE_KEY) === "1";
}

export function markSetupComplete(): void {
  localStorage.setItem(SETUP_COMPLETE_KEY, "1");
}

// ── Brand Rail (left panel) ─────────────────────────────────────

function BrandRail() {
  return (
    <div className="hidden lg:flex w-[46%] shrink-0 flex-col justify-between bg-[#0b0b0d] px-10 py-10 text-white">
      <div>
        <div className="text-[18px] font-bold tracking-tight">nexu</div>
        <p className="mt-1 text-[12px] text-white/50">
          Open-source AI agent runtime
        </p>
      </div>

      <div className="space-y-6">
        <div className="space-y-4">
          {[
            {
              title: "Multi-channel AI agents",
              desc: "Deploy agents to Slack, Discord, Feishu and more.",
            },
            {
              title: "Bring any model",
              desc: "Use Nexu cloud models or plug in your own API keys.",
            },
            {
              title: "Built for teams",
              desc: "Skills, sandboxes, and memory — all configurable.",
            },
          ].map((f) => (
            <div key={f.title}>
              <div className="text-[13px] font-medium text-white/90">
                {f.title}
              </div>
              <div className="text-[11px] text-white/45 leading-relaxed">
                {f.desc}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="text-[11px] text-white/30">
        <a
          href="https://github.com/nexu-ai/nexu"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-white/50 transition-colors"
        >
          github.com/nexu-ai/nexu
        </a>
      </div>
    </div>
  );
}

// ── Entry Cards ─────────────────────────────────────────────────

interface EntryOption {
  id: "login" | "byok";
  title: string;
  badge: string;
  description: string;
  highlights: string[];
  icon: typeof Zap;
  tone: "primary" | "secondary";
}

const ENTRY_OPTIONS: EntryOption[] = [
  {
    id: "login",
    title: "Nexu Cloud",
    badge: "Recommended",
    description:
      "Sign in with your Nexu account. Access premium models with no API key setup needed.",
    highlights: ["Claude Opus 4.6", "GPT-5.4", "Unlimited usage"],
    icon: Zap,
    tone: "primary",
  },
  {
    id: "byok",
    title: "Bring Your Own Key",
    badge: "Self-managed",
    description:
      "Use your own API keys from Anthropic, OpenAI, Google, or any OpenAI-compatible endpoint.",
    highlights: ["Anthropic", "OpenAI", "Google AI"],
    icon: Key,
    tone: "secondary",
  },
];

// ── Page Component ──────────────────────────────────────────────

export function WelcomePage() {
  const navigate = useNavigate();
  const [cloudConnecting, setCloudConnecting] = useState(false);

  // If already set up, skip welcome
  if (isSetupComplete()) {
    return <Navigate to="/workspace" replace />;
  }

  const handleCloudLogin = async () => {
    setCloudConnecting(true);
    try {
      // Try desktop cloud-connect flow
      const res = await fetch("/api/internal/desktop/cloud-connect", {
        method: "POST",
      });
      if (res.ok) {
        const data = (await res.json()) as { browserUrl?: string };
        if (data.browserUrl) {
          window.open(data.browserUrl, "_blank", "noopener,noreferrer");
        }
      }
    } catch {
      // Not in desktop mode or API unavailable — fall back to web auth
      window.open("/auth", "_blank", "noopener,noreferrer");
    }
    setCloudConnecting(false);
  };

  const handleByok = () => {
    navigate("/workspace/models?setup=1");
  };

  return (
    <div className="min-h-screen bg-[#0b0b0d] text-white">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <BrandRail />

        <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#f7f5ef] px-5 py-8 text-text-primary sm:px-8 lg:px-10">
          <div className="absolute inset-0 bg-[radial-gradient(80%_80%_at_20%_15%,rgba(0,0,0,0.035),transparent_45%)]" />

          <div className="relative z-10 w-full max-w-[620px]">
            {/* Mobile header */}
            <nav className="mb-8 flex items-center justify-between lg:hidden">
              <span className="text-[16px] font-bold tracking-tight">
                nexu
              </span>
              <span className="text-[11px] uppercase tracking-[0.16em] text-text-muted">
                Get started
              </span>
            </nav>

            <div className="rounded-[32px] border border-black/10 bg-white/88 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.08)] backdrop-blur-sm sm:p-7">
              <div className="border-b border-black/8 pb-6">
                <h2
                  className="text-[34px] leading-[0.98] tracking-tight text-[#181816] sm:text-[42px]"
                  style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
                >
                  Get started
                </h2>
                <p className="mt-3 text-[14px] text-text-secondary">
                  Choose how you want to connect AI models.
                </p>
              </div>

              <div className="mt-5 space-y-3">
                {ENTRY_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      if (option.id === "login") {
                        handleCloudLogin();
                      } else {
                        handleByok();
                      }
                    }}
                    disabled={option.id === "login" && cloudConnecting}
                    className={`group w-full rounded-[28px] border p-5 text-left transition-all duration-300 cursor-pointer ${
                      option.tone === "primary"
                        ? "border-black/12 bg-[linear-gradient(135deg,#18181b_0%,#232327_100%)] text-white hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(0,0,0,0.16)]"
                        : "border-black/10 bg-[#f5f2ea] text-text-primary hover:-translate-y-0.5 hover:border-black/18 hover:shadow-[0_12px_26px_rgba(0,0,0,0.06)]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`flex h-11 w-11 items-center justify-center rounded-2xl shrink-0 ${
                            option.tone === "primary"
                              ? "bg-white/[0.08] text-white"
                              : "bg-white text-text-primary border border-black/8"
                          }`}
                        >
                          <option.icon size={18} />
                        </div>
                        <div
                          className={`text-[22px] leading-none tracking-tight ${
                            option.tone === "primary"
                              ? "text-white"
                              : "text-[#1b1b19]"
                          }`}
                          style={{
                            fontFamily: "Georgia, 'Times New Roman', serif",
                          }}
                        >
                          {option.title}
                        </div>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] shrink-0 ${
                          option.tone === "primary"
                            ? "bg-white/[0.08] text-white/75"
                            : "border border-black/10 bg-white/70 text-text-secondary"
                        }`}
                      >
                        {option.badge}
                      </span>
                    </div>

                    <div className="mt-4 flex items-start justify-between gap-4">
                      <p
                        className={`max-w-[430px] text-[13px] leading-[1.75] ${
                          option.tone === "primary"
                            ? "text-white/64"
                            : "text-text-secondary"
                        }`}
                      >
                        {option.description}
                      </p>
                      <ArrowRight
                        size={16}
                        className={`mt-1 shrink-0 ${option.tone === "primary" ? "text-white/55" : "text-text-muted"}`}
                      />
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {option.highlights.map((tag) => (
                        <span
                          key={tag}
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] ${
                            option.tone === "primary"
                              ? "border border-white/10 bg-white/[0.06] text-white/78"
                              : "border border-black/8 bg-white/70 text-text-secondary"
                          }`}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
