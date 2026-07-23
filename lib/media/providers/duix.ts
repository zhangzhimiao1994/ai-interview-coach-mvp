import { createHmac, randomUUID } from "node:crypto";
import { readAiConfigSecret } from "@/lib/domain/aiServices";
import type { ResolvedMediaModel } from "@/lib/media/config";
import type {
  DigitalHumanSessionInput,
  DigitalHumanSpeakInput,
  RealtimeDigitalHumanProvider
} from "@/lib/media/types";
import {
  duixAdapterContract,
  resolveDuixCredentials
} from "@/lib/media/providers/duixCredentials";

export type DuixDependencies = {
  readConfigSecret: () => string;
  now: () => Date;
  randomId: () => string;
};

export type DuixSignInput = {
  appId: string;
  appSecret: string;
  now: Date;
  ttlSeconds: number;
};

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

export function createDuixSign({
  appId,
  appSecret,
  now,
  ttlSeconds
}: DuixSignInput) {
  const iat = Math.floor(now.getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    appId,
    iat,
    exp: iat + ttlSeconds
  }));
  const signature = createHmac("sha256", appSecret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

export function createDuixProvider(
  model: ResolvedMediaModel,
  dependencyOverrides: Partial<DuixDependencies> = {}
): RealtimeDigitalHumanProvider {
  const deps: DuixDependencies = {
    readConfigSecret: readAiConfigSecret,
    now: () => new Date(),
    randomId: randomUUID,
    ...dependencyOverrides
  };
  const credentials = resolveDuixCredentials(model, deps.readConfigSecret);
  const ttlSeconds = 600;

  return {
    async createSession(_input: DigitalHumanSessionInput) {
      const now = deps.now();
      const traceId = deps.randomId();
      const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
      const sign = createDuixSign({
        appId: credentials.appId,
        appSecret: credentials.appSecret,
        now,
        ttlSeconds
      });

      return {
        provider: model.providerName,
        model: model.modelName,
        mode: "duix-h5-direct-drive",
        traceId,
        fallbackUsed: false,
        sessionId: traceId,
        providerSessionId: traceId,
        connection: {
          protocol: "webrtc",
          metadata: {
            adapter: duixAdapterContract.adapter,
            sign,
            conversationId: credentials.conversationId,
            platform: credentials.platform,
            sdkPackage: "duix-guiji",
            openAsr: false,
            speechMode: duixAdapterContract.speechMode
          }
        },
        expiresAt: expiresAt.toISOString()
      };
    },

    async speak(_sessionId: string, input: DigitalHumanSpeakInput) {
      const traceId = input.requestId || deps.randomId();
      return {
        provider: model.providerName,
        model: model.modelName,
        mode: "duix-h5-client-speak",
        traceId,
        fallbackUsed: false,
        speechId: traceId,
        accepted: true
      };
    },

    async stopSession(_sessionId: string) {
      return undefined;
    },

    async checkConnection() {
      const startedAt = deps.now().getTime();
      return {
        provider: model.providerName,
        model: model.modelName,
        mode: "duix-h5-sign",
        traceId: deps.randomId(),
        fallbackUsed: false,
        available: true,
        latencyMs: Math.max(0, deps.now().getTime() - startedAt),
        checkedAt: deps.now().toISOString(),
        code: "ADAPTER_AVAILABLE",
        message: "DUIX sign generation is available."
      };
    }
  };
}
