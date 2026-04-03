import type {
  ChannelFallbackAdapter,
  ChannelReplyOutcomePayload,
  FallbackErrorCode,
  FallbackTemplateMap,
  NormalizedFallback,
} from "../core/channel-fallback-types.js";

const FEISHU_FALLBACK_TEMPLATES: FallbackTemplateMap = {
  unknown: {
    en: "🤖 Sorry, I can't handle your request right now. Please try again later, or contact the NexU team for support: https://docs.nexu.io/guide/contact",
    "zh-CN":
      "🤖 抱歉，我暂时无法处理你的请求，请稍后重试，或联系 NexU 工作人员获取支持：https://docs.nexu.io/zh/guide/contact",
  },
  internal_error: {
    en: "Sorry, I hit an internal error while replying. Please try again in a moment.",
    "zh-CN": "抱歉，我刚刚回复时遇到内部错误。请稍后再试。",
  },
  missing_api_key: {
    en: "⚠️ No access credentials detected. Please check that you are logged in or that you have entered your API key. If the issue persists, see https://docs.nexu.io/guide/contact",
    "zh-CN":
      "⚠️ 未检测到访问凭证，暂时无法继续使用。请先检查是否已经完成账号登录，或是否已经填写访问密钥（用于连接模型服务的凭证）。如仍无法解决，请查看 https://docs.nexu.io/zh/guide/contact",
  },
  invalid_api_key: {
    en: "⚠️ The API key you entered is invalid. Please check it for typos or try a different key. If the issue persists, see https://docs.nexu.io/guide/contact",
    "zh-CN":
      "⚠️ 你填写的访问密钥无效，暂时无法使用。请检查是否复制完整、是否填错，或换一个新的密钥后再试。如仍无法解决，请查看 https://docs.nexu.io/zh/guide/contact",
  },
  forbidden_api_key: {
    en: "⚠️ Your API key is no longer usable — it may have expired or been revoked. Please replace it and try again. If the issue persists, see https://docs.nexu.io/guide/contact",
    "zh-CN":
      "⚠️ 当前访问密钥不可用，可能已经过期、被停用或被撤销。请更换一个可用的密钥后再试。如仍无法解决，请查看 https://docs.nexu.io/zh/guide/contact",
  },
  insufficient_credits: {
    en: "⚠️ Insufficient credits. You can earn credits by completing tasks, or switch to using your own API key (BYOK). If the issue persists, see https://docs.nexu.io/guide/contact",
    "zh-CN":
      "⚠️ 当前可用积分不足，暂时无法继续使用。你可以通过完成任务赚取积分，或切换到自带密钥（BYOK）的方式继续使用。如仍无法解决，请查看 https://docs.nexu.io/zh/guide/contact",
  },
  usage_limit_exceeded: {
    en: "⚠️ You've reached the usage limit for this period. Please try again later. If the issue persists, see https://docs.nexu.io/guide/contact",
    "zh-CN":
      "⚠️ 当前请求过于频繁，已达到本时段的使用上限，请稍后再试。如仍无法解决，请查看 https://docs.nexu.io/zh/guide/contact",
  },
  invalid_json: {
    en: "⚠️ The submitted content has an invalid format. Please check and resubmit. If the issue persists, see https://docs.nexu.io/guide/contact",
    "zh-CN":
      "⚠️ 提交的内容格式不正确，系统暂时无法识别。请检查后重新提交。如仍无法解决，请查看 https://docs.nexu.io/zh/guide/contact",
  },
  invalid_model: {
    en: "⚠️ The current model is temporarily unavailable. Please try again later. If the issue persists, see https://docs.nexu.io/guide/contact",
    "zh-CN":
      "⚠️ 当前模型暂不可用，请稍后重试。如仍无法解决，请查看 https://docs.nexu.io/zh/guide/contact",
  },
  invalid_request: {
    en: "⚠️ The request is invalid. Please check that all fields are filled in correctly and try again. If the issue persists, see https://docs.nexu.io/guide/contact",
    "zh-CN":
      "⚠️ 本次提交的内容有误，系统暂时无法处理。请检查填写内容是否完整、格式是否正确，然后再试一次。如仍无法解决，请查看 https://docs.nexu.io/zh/guide/contact",
  },
  model_not_found: {
    en: "⚠️ The selected model is not available. It may not be configured yet or is temporarily inaccessible. Please switch to another model or check your settings. If the issue persists, see https://docs.nexu.io/guide/contact",
    "zh-CN":
      "⚠️ 你选择的模型当前不可用，可能尚未配置成功，或暂时无法访问。请更换其他模型，或检查相关设置后重试。如仍无法解决，请查看 https://docs.nexu.io/zh/guide/contact",
  },
  request_too_large: {
    en: "⚠️ The request is too large. Please shorten your message, reduce attachments, or split into multiple messages. If the issue persists, see https://docs.nexu.io/guide/contact",
    "zh-CN":
      "⚠️ 本次提交的内容过多，系统暂时无法处理。请缩短消息内容、减少附件或分几次发送后再试。如仍无法解决，请查看 https://docs.nexu.io/zh/guide/contact",
  },
  streaming_unsupported: {
    en: "⚠️ Streaming is not supported for this request. Please try a different approach or try again later. If the issue persists, see https://docs.nexu.io/guide/contact",
    "zh-CN":
      "⚠️ 当前暂不支持这种返回方式，请换一种方式再试，或稍后重试。如仍无法解决，请查看 https://docs.nexu.io/zh/guide/contact",
  },
  upstream_error: {
    en: "⚠️ The upstream model service is temporarily unavailable. Please try again later or switch to a different model. If the issue persists, see https://docs.nexu.io/guide/contact",
    "zh-CN":
      "⚠️ 当前连接的模型服务暂时不可用，请稍后重试，或更换其他模型后再试。如仍无法解决，请查看 https://docs.nexu.io/zh/guide/contact",
  },
  reply_delivery_failed: {
    en: "Sorry, I couldn't deliver the previous reply successfully. Please try again in a moment.",
    "zh-CN": "抱歉，我刚刚没有成功送达上一条回复。请稍后再试。",
  },
  no_final_reply: {
    en: "Sorry, I couldn't finish the previous reply. Please try again in a moment.",
    "zh-CN": "抱歉，我刚刚没有完整完成上一条回复。请稍后再试。",
  },
  synthetic_pre_llm_failure: {
    en: "Sorry, Nexu intentionally interrupted this reply for diagnostics.",
    "zh-CN": "抱歉，这条回复被 Nexu 为诊断目的主动中断。",
  },
};

export class FeishuFallbackAdapter
  implements ChannelFallbackAdapter<FallbackErrorCode>
{
  readonly channel = "feishu";

  shouldHandle(payload: ChannelReplyOutcomePayload): boolean {
    if (payload.channel !== this.channel) {
      return false;
    }
    return payload.status === "failed" || payload.status === "silent";
  }

  normalize(
    payload: ChannelReplyOutcomePayload,
  ): NormalizedFallback<FallbackErrorCode> | null {
    const target = payload.to ?? chatIdToTarget(payload.chatId);
    if (!target) {
      return null;
    }

    const threadId = payload.replyToMessageId ?? payload.threadId ?? undefined;
    const actionId =
      payload.actionId ?? payload.turnId ?? payload.messageId ?? null;
    const receivedAt = payload.ts ?? new Date().toISOString();
    const override = parseSyntheticOverride(payload.syntheticInput);
    const errorCode =
      override?.errorCode ??
      extractFeishuErrorCode(payload.error) ??
      mapFeishuErrorCode(payload);
    const dedupeKey = payload.replyToMessageId ?? payload.messageId ?? null;

    return {
      channel: payload.channel,
      accountId: payload.accountId,
      actionId,
      receivedAt,
      claimKey: dedupeKey
        ? [
            payload.channel,
            payload.accountId ?? "default",
            dedupeKey,
            errorCode,
          ].join(":")
        : null,
      target: {
        to: target,
        threadId,
      },
      errorCode,
      params: {
        reasonCode: payload.reasonCode ?? payload.status,
        ...(override?.params ?? {}),
      },
      reasonCode: payload.reasonCode,
    };
  }

  resolveLang(_normalized: NormalizedFallback<FallbackErrorCode>) {
    return "en" as const;
  }

  getTemplateMap(): FallbackTemplateMap<FallbackErrorCode> {
    return FEISHU_FALLBACK_TEMPLATES;
  }

  toSendInput(input: {
    normalized: NormalizedFallback<FallbackErrorCode>;
    lang: "en" | "zh-CN";
    message: string;
  }) {
    const message = appendOptionalDiagnosticHint(
      input.message,
      input.normalized.params.hint,
      input.normalized.errorCode,
      input.lang,
    );

    return {
      channel: input.normalized.channel,
      accountId: input.normalized.accountId,
      to: input.normalized.target.to,
      threadId: input.normalized.target.threadId,
      message,
    };
  }
}

function appendOptionalDiagnosticHint(
  message: string,
  hint: string | undefined,
  errorCode: FallbackErrorCode,
  lang: "en" | "zh-CN",
): string {
  if (errorCode !== "unknown") {
    return message;
  }
  const trimmedHint = hint?.trim();
  if (!trimmedHint) {
    return message;
  }

  let suffix: string;
  switch (lang) {
    case "zh-CN":
      suffix = `诊断提示：${trimmedHint}`;
      break;
    default:
      suffix = `Diagnostic hint: ${trimmedHint}`;
      break;
  }

  return [message, suffix].join("\n\n");
}

function parseSyntheticOverride(
  syntheticInput?: string,
): { errorCode: FallbackErrorCode; params: Record<string, string> } | null {
  if (!syntheticInput) {
    return null;
  }

  try {
    const parsed = JSON.parse(syntheticInput) as {
      errorCode?: unknown;
      params?: unknown;
    };
    const errorCode = normalizeFallbackErrorCode(parsed.errorCode);
    return {
      errorCode,
      params: normalizeTemplateParams(parsed.params),
    };
  } catch {
    return {
      errorCode: "unknown",
      params: {},
    };
  }
}

function normalizeFallbackErrorCode(value: unknown): FallbackErrorCode {
  switch (value) {
    case "unknown":
    case "internal_error":
    case "missing_api_key":
    case "invalid_api_key":
    case "forbidden_api_key":
    case "insufficient_credits":
    case "usage_limit_exceeded":
    case "invalid_json":
    case "invalid_model":
    case "invalid_request":
    case "model_not_found":
    case "request_too_large":
    case "streaming_unsupported":
    case "upstream_error":
    case "reply_delivery_failed":
    case "no_final_reply":
    case "synthetic_pre_llm_failure":
      return value;
    default:
      return "unknown";
  }
}

function normalizeTemplateParams(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(
      ([key, entryValue]) => [key, String(entryValue)],
    ),
  );
}

function mapFeishuErrorCode(
  payload: ChannelReplyOutcomePayload,
): FallbackErrorCode {
  switch (payload.reasonCode) {
    case "synthetic_pre_llm_failure":
      return "synthetic_pre_llm_failure";
    case "final_reply_failed":
    case "block_reply_failed":
    case "media_reply_failed":
    case "dispatch_threw":
      return "reply_delivery_failed";
    case "no_final_reply":
      return "no_final_reply";
    default:
      return "unknown";
  }
}

function extractFeishuErrorCode(errorText?: string): FallbackErrorCode | null {
  if (!errorText) {
    return null;
  }

  const codeTagMatch = errorText.match(/\[code=([^\]]+)\]/);
  const taggedCode = normalizeFallbackErrorCode(codeTagMatch?.[1]);
  if (taggedCode !== "unknown") {
    return taggedCode;
  }

  for (const code of FEISHU_PROVIDER_ERROR_CODES) {
    if (errorText.includes(code)) {
      return code;
    }
  }

  return null;
}

const FEISHU_PROVIDER_ERROR_CODES = [
  "missing_api_key",
  "invalid_api_key",
  "forbidden_api_key",
  "insufficient_credits",
  "usage_limit_exceeded",
  "invalid_json",
  "invalid_model",
  "invalid_request",
  "model_not_found",
  "request_too_large",
  "internal_error",
  "streaming_unsupported",
  "upstream_error",
] as const;

function chatIdToTarget(chatId?: string): string | null {
  if (!chatId) {
    return null;
  }
  return `chat:${chatId}`;
}
