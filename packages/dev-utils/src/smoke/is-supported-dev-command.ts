import { supportedDevCommands } from "./supported-dev-commands.js";

export function isSupportedDevCommand(command: string): boolean {
  return supportedDevCommands.has(command);
}
