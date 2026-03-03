import { useState } from "react";

const isPreviewEnvironment = import.meta.env.VITE_PREVIEW === "true";
const shortCommitHash =
  import.meta.env.VITE_COMMIT_HASH?.slice(0, 7) || "unknown";

export function PreviewBanner() {
  const [dismissed, setDismissed] = useState(false);

  if (!isPreviewEnvironment || dismissed) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 top-0 z-[2147483647] flex items-center justify-between bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-lg">
      <span>Preview Environment · {shortCommitHash}</span>
      <button
        type="button"
        className="ml-3 rounded px-2 py-0.5 text-base leading-none text-white/90 transition-colors hover:bg-white/15 hover:text-white"
        aria-label="Close preview environment banner"
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
    </div>
  );
}
