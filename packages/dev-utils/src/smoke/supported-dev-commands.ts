export const supportedDevCommandList = [
  "start",
  "restart",
  "stop",
  "status",
  "logs",
  "help",
] as const;

export const supportedDevCommands = new Set<string>(supportedDevCommandList);

export type DevCommand = (typeof supportedDevCommandList)[number];
