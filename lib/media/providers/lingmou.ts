import LingMouClient, {
  CloseChatInstanceSessionsRequest,
  CreateChatSessionRequest
} from "@alicloud/lingmou20250527";
import { $OpenApiUtil } from "@alicloud/openapi-core";
import type { LingmouRtcConnection } from "@/lib/client/lingmouRtcConnection";
import { readAiConfigSecret } from "@/lib/domain/aiServices";
import type { ResolvedMediaModel } from "@/lib/media/config";
import { MediaProviderError } from "@/lib/media/errors";
import {
  resolveLingmouCloseCredentials,
  resolveLingmouCredentials,
  type LingmouCloseCredentialSource,
  type LingmouCloseCredentials
} from "@/lib/media/providers/lingmouCredentials";

export type { LingmouRtcConnection } from "@/lib/client/lingmouRtcConnection";

export interface LingmouProvider {
  createSession(): Promise<{
    providerSessionId: string;
    connection: LingmouRtcConnection;
  }>;
  closeSession(providerSessionId: string): Promise<void>;
}

export type LingmouSessionCloser = Pick<LingmouProvider, "closeSession">;

export class LingmouSessionRecoveryError extends MediaProviderError {
  readonly #identity: { providerSessionId: string; instanceId: string };

  constructor(providerSessionId: string, instanceId: string) {
    super(
      "Lingmou invalid session cleanup failed",
      "LINGMOU",
      "LINGMOU_CREATE_COMPENSATION_CLOSE_FAILED"
    );
    this.name = "LingmouSessionRecoveryError";
    this.#identity = { providerSessionId, instanceId };
  }

  recoveryIdentity() {
    return { ...this.#identity };
  }
}

type LingmouCreateResponse = {
  body?: {
    success?: boolean;
    data?: {
      sessionId?: string;
      rtcParams?: {
        appId?: string;
        avatarUserId?: string;
        channel?: string;
        clientUserId?: string;
        serverUserId?: string;
        timestamp?: number;
        token?: string;
      };
    };
  };
};

export interface LingmouSdkClient {
  createChatSession(
    configId: string,
    request: CreateChatSessionRequest
  ): Promise<LingmouCreateResponse>;
  closeChatInstanceSessions(
    instanceId: string,
    request: CloseChatInstanceSessionsRequest
  ): Promise<unknown>;
}

export type LingmouDependencies = {
  createClient: (credentials: LingmouCloseCredentials) => LingmouSdkClient;
  readConfigSecret: () => string;
};

function createSdkClient(
  credentials: LingmouCloseCredentials
): LingmouSdkClient {
  return new LingMouClient(new $OpenApiUtil.Config({
    accessKeyId: credentials.accessKeyId,
    accessKeySecret: credentials.accessKeySecret,
    regionId: credentials.region
  }));
}

export function createLingmouSessionCloser(
  source: LingmouCloseCredentialSource,
  persistedInstanceId: string,
  dependencyOverrides: Partial<LingmouDependencies> = {}
): LingmouSessionCloser {
  const credentials = resolveLingmouCloseCredentials(
    source,
    persistedInstanceId,
    dependencyOverrides.readConfigSecret ?? readAiConfigSecret
  );
  const client = (dependencyOverrides.createClient ?? createSdkClient)(
    credentials
  );

  return {
    async closeSession(providerSessionId: string) {
      try {
        await client.closeChatInstanceSessions(
          credentials.instanceId,
          new CloseChatInstanceSessionsRequest({
            sessionIds: [providerSessionId]
          })
        );
      } catch (error) {
        throw providerError(error);
      }
    }
  };
}

function sdkErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const code = "code" in error ? error.code : undefined;
  return typeof code === "string" ? code.toLowerCase() : "";
}

function sdkStatus(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const statusCode = "statusCode" in error ? error.statusCode : undefined;
  return typeof statusCode === "number" ? statusCode : undefined;
}

function providerError(error: unknown) {
  const code = sdkErrorCode(error);
  const status = sdkStatus(error);
  let safeCode = "LINGMOU_UPSTREAM_FAILED";

  if (
    status === 401 ||
    status === 403 ||
    /(accesskey|signature|auth|forbidden|unauthorized)/.test(code)
  ) {
    safeCode = "LINGMOU_AUTH_FAILED";
  } else if (/(config).*(notfound|not_found|notexist)/.test(code)) {
    safeCode = "LINGMOU_CONFIG_NOT_FOUND";
  } else if (/(instance).*(unavailable|notavailable|disabled|expired)/.test(code)) {
    safeCode = "LINGMOU_INSTANCE_UNAVAILABLE";
  }

  return new MediaProviderError(
    "Lingmou request failed",
    "LINGMOU",
    safeCode,
    safeCode === "LINGMOU_UPSTREAM_FAILED"
  );
}

function requiredText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function providerSessionId(response: LingmouCreateResponse): string {
  const data = response.body?.data;
  const sessionId = requiredText(data?.sessionId);

  if (
    response.body?.success !== true ||
    !sessionId
  ) {
    throw providerError(undefined);
  }

  return sessionId;
}

function rtcConnection(
  response: LingmouCreateResponse,
  sessionId: string
): LingmouRtcConnection {
  const rtc = response.body?.data?.rtcParams;
  const appId = requiredText(rtc?.appId);
  const avatarUserId = requiredText(rtc?.avatarUserId);
  const channel = requiredText(rtc?.channel);
  const clientUserId = requiredText(rtc?.clientUserId);
  const serverUserId = requiredText(rtc?.serverUserId);
  const timestamp = rtc?.timestamp;
  const token = requiredText(rtc?.token);

  if (
    !appId ||
    !avatarUserId ||
    !channel ||
    !clientUserId ||
    !serverUserId ||
    typeof timestamp !== "number" ||
    !Number.isFinite(timestamp) ||
    !token
  ) {
    throw providerError(undefined);
  }

  return {
    appId,
    avatarUserId,
    channel,
    clientUserId,
    serverUserId,
    timestamp,
    token,
    sessionId
  };
}

export function createLingmouProvider(
  model: ResolvedMediaModel,
  dependencyOverrides: Partial<LingmouDependencies> = {}
): LingmouProvider {
  const credentials = resolveLingmouCredentials(
    model,
    dependencyOverrides.readConfigSecret ?? readAiConfigSecret
  );
  const client = (dependencyOverrides.createClient ?? createSdkClient)(credentials);

  return {
    async createSession() {
      let response: LingmouCreateResponse;
      try {
        response = await client.createChatSession(
          credentials.configId,
          new CreateChatSessionRequest({ instanceId: credentials.instanceId })
        );
      } catch (error) {
        throw providerError(error);
      }

      const sessionId = providerSessionId(response);
      let connection: LingmouRtcConnection;
      try {
        connection = rtcConnection(response, sessionId);
      } catch {
        try {
          await client.closeChatInstanceSessions(
            credentials.instanceId,
            new CloseChatInstanceSessionsRequest({ sessionIds: [sessionId] })
          );
        } catch {
          throw new LingmouSessionRecoveryError(
            sessionId,
            credentials.instanceId
          );
        }
        throw providerError(undefined);
      }
      return {
        providerSessionId: connection.sessionId,
        connection
      };
    },

    async closeSession(providerSessionId: string) {
      try {
        await client.closeChatInstanceSessions(
          credentials.instanceId,
          new CloseChatInstanceSessionsRequest({
            sessionIds: [providerSessionId]
          })
        );
      } catch (error) {
        throw providerError(error);
      }
    }
  };
}
