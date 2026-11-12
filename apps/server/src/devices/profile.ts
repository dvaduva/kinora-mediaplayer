import {
  applyDeviceOverrides,
  applyPlatformQuirks,
  BROWSER_PROFILE,
  type CapabilityProfile,
  type DeviceView,
  type EffectiveProfile,
} from "@kinora/shared";

/**
 * The profile the playback plan uses for a request: the browser's for the web UI and the shared key;
 * for a paired device, what it reported (the browser's until it reports), with the platform's known
 * quirks and the user's switches from Settings → Devices applied.
 */
export function profileFor(device: DeviceView | null): CapabilityProfile | EffectiveProfile {
  if (!device) return BROWSER_PROFILE;
  const reported = device.capabilities ? applyPlatformQuirks(device.platform, device.capabilities) : BROWSER_PROFILE;
  return applyDeviceOverrides(reported, device.overrides);
}
