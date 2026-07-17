import { ApiConflictError } from "@/lib/api/errors";

const closeCriticalProviderFields = [
  "providerType",
  "settingsJson",
  "credentialsCiphertext",
  "credentialsIv",
  "credentialsTag"
] as const;

type CloseCriticalProviderRecord = Record<
  (typeof closeCriticalProviderFields)[number],
  unknown
>;

type DigitalHumanSessionCounter = {
  digitalHumanSession: {
    count: (args: {
      where: {
        providerId: string;
        mode: "LINGMOU_CLOUD";
        status: { not: "STOPPED" };
      };
    }) => Promise<number>;
  };
  providerSessionCloseRecovery: {
    count: (args: {
      where: { providerId: string };
    }) => Promise<number>;
  };
};

const providerInUseMessage =
  "Stop all digital-human sessions before changing or deleting this provider's close configuration.";

export function changesProviderCloseConfiguration(
  existing: CloseCriticalProviderRecord,
  update: Record<string, unknown>
) {
  return closeCriticalProviderFields.some(
    (field) =>
      Object.prototype.hasOwnProperty.call(update, field) &&
      update[field] !== existing[field]
  );
}

export async function assertProviderCloseConfigurationMutable(
  store: DigitalHumanSessionCounter,
  providerId: string
) {
  const dependentSessions = await store.digitalHumanSession.count({
    where: {
      providerId,
      mode: "LINGMOU_CLOUD",
      status: { not: "STOPPED" }
    }
  });
  if (dependentSessions > 0) {
    throw new ApiConflictError(providerInUseMessage);
  }
  const pendingRecoveries = await store.providerSessionCloseRecovery.count({
    where: { providerId }
  });
  if (pendingRecoveries > 0) {
    throw new ApiConflictError(providerInUseMessage);
  }
}

export function asProviderCloseConfigurationConflict(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : null;
  const message = error instanceof Error ? error.message : String(error);
  if (
    code === "P2034" ||
    message.includes("DIGITAL_HUMAN_PROVIDER_IN_USE")
  ) {
    return new ApiConflictError(providerInUseMessage);
  }
  return error;
}
