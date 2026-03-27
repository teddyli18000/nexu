export const supportedDevCommandList = [
  "start",
  "restart",
  "stop",
  "status",
  "logs",
  "help",
] as const;

export type DevCommand = (typeof supportedDevCommandList)[number];

const supportedDevCommands = new Set<string>(supportedDevCommandList);

export function isSupportedDevCommand(command: string): boolean {
  return supportedDevCommands.has(command);
}
