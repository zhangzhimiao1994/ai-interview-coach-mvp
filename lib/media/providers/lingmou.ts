import LingMouClient, {
  CloseChatInstanceSessionsRequest,
  CreateChatSessionRequest
} from "@alicloud/lingmou20250527";
import { $OpenApiUtil } from "@alicloud/openapi-core";
import { readAiConfigSecret } from "@/lib/domain/aiServices";
import type { ResolvedMediaModel } from "@/lib/media/config";
import { MediaProviderError } from "@/lib/media/errors";
import {
  resolveLingmouCloseCredentials,
  resolveLingmouCredentials,
  type LingmouCloseCredentialSource,
  type LingmouCloseCredentials
} from "@/lib/media/providers/lingmouCredentials";

export type LingmouRtcConnection = {
  appId: string;
  avatarUserId: string;
  channel: string;
  clientUserId: string;
  serverUserId: string;
  timestamp: number;
  token: string;
  sessionId: string;
};

export interface LingmouProvider {
  createSession(): Promise<{
    providerSessionId: string;
    connection: LingmouRtcConnection;
  }>;
  closeSession(providerSessionId: string): Promise<void>;
}

export type LingmouSessionCloser = Pick<LingmouProvider, "closeSession">;

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

function requiredText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function rtcConnection(response: LingmouCreateResponse): LingmouRtcConnection {
  const data = response.body?.data;
  const rtc = data?.rtcParams;

  if (
    response.body?.success !== true ||
    !requiredText(data?.sessionId) ||
    !requiredText(rtc?.appId) ||
    !requiredText(rtc.avatarUserId) ||
    !requiredText(rtc.channel) ||
    !requiredText(rtc.clientUserId) ||
    !requiredText(rtc.serverUserId) ||
    typeof rtc.timestamp !== "number" ||
    !Number.isFinite(rtc.timestamp) ||
    !requiredText(rtc.token)
  ) {
    throw providerError(undefined);
  }

  return {
    appId: rtc.appId,
    avatarUserId: rtc.avatarUserId,
    channel: rtc.channel,
    clientUserId: rtc.clientUserId,
    serverUserId: rtc.serverUserId,
    timestamp: rtc.timestamp,
    token: rtc.token,
    sessionId: data.sessionId
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

      const connection = rtcConnection(response);
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
