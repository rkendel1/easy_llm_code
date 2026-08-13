export type SupportedPlatform = "darwin-arm64" | "darwin-x64" | "linux-arm64" | "linux-x64" | "win32-x64";

export const resolvePlatform = (platform = process.platform, architecture = process.arch): SupportedPlatform => {
  const key = `${platform}-${architecture}`;
  if (["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"].includes(key)) return key as SupportedPlatform;
  throw new Error(`UNSUPPORTED_PLATFORM: ${platform}/${architecture}`);
};
