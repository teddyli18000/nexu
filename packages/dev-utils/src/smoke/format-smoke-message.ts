export function formatSmokeMessage(command: string, args: string[]): string {
  const suffix = args.length > 0 ? ` ${args.join(" ")}` : "";
  return `[scripts-dev] smoke ok -> ${command}${suffix}`;
}
