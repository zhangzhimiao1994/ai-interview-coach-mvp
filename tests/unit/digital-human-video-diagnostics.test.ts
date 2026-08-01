import { describe, expect, it } from "vitest";
import { MediaProviderError } from "@/lib/media/errors";
import { encryptCredentialMap, encryptSecret } from "@/lib/domain/aiServices";
import { encryptOssCredentials } from "@/lib/media/storage/ossCredentials";
import { createLingmouBroadcastProvider } from "@/lib/media/video/providers/lingmouBroadcast";
import {
  DigitalHumanVideoDiagnosticInputError,
  inspectDigitalHumanVideoConfiguration,
  runDigitalHumanVideoDiagnostic,
  type DigitalHumanVideoDiagnosticDependencies,
  type DigitalHumanVideoConfigurationDependencies
} from "@/lib/media/video/diagnostics";

describe("digital human video diagnostics", () => {
  it("performs a configuration-only check without any external or paid boundary", async () => {
    const calls = counters();
    const result = await runDigitalHumanVideoDiagnostic(
      { mode: "CONFIG", providerKind: "LINGMOU_BROADCAST" },
      "admin-1",
      dependencies(calls)
    );

    expect(result).toMatchObject({
      status: "CONFIG_VALID",
      code: "CONFIG_VALID",
      providerKind: "LINGMOU_BROADCAST",
      traceId: null
    });
    expect(calls).toEqual({ inspect: 1, prepare: 0, sign: 0, lingmou: 0, emo: 0, audit: 0 });
  });

  it.each([undefined, false])(
    "fails closed for paid diagnostics when confirmation is %s",
    async (confirmPaidRequest) => {
      const calls = counters();
      await expect(runDigitalHumanVideoDiagnostic(
        {
          mode: "PAID",
          providerKind: "ALIBABA_EMO",
          confirmPaidRequest
        },
        "admin-1",
        dependencies(calls)
      )).rejects.toBeInstanceOf(DigitalHumanVideoDiagnosticInputError);
      expect(calls).toEqual({ inspect: 0, prepare: 0, sign: 0, lingmou: 0, emo: 0, audit: 0 });
    }
  );

  it.each([
    ["LINGMOU_BROADCAST", 1, 0],
    ["ALIBABA_EMO", 0, 1]
  ] as const)("submits exactly one selected %s paid operation", async (
    providerKind,
    expectedLingmou,
    expectedEmo
  ) => {
    const calls = counters();
    const events: string[] = [];
    const result = await runDigitalHumanVideoDiagnostic({
      mode: "PAID",
      providerKind,
      confirmPaidRequest: true
    }, "admin-1", dependencies(calls, events));

    expect(result).toMatchObject({
      status: "REACHABLE",
      code: "REACHABLE",
      providerKind,
      traceId: providerKind === "LINGMOU_BROADCAST"
        ? "11111111-1111-4111-8111-111111111111"
        : "22222222-2222-4222-8222-222222222222"
    });
    expect(calls.lingmou).toBe(expectedLingmou);
    expect(calls.emo).toBe(expectedEmo);
    expect(calls.prepare).toBe(1);
    expect(calls.sign).toBe(2);
    expect(calls.audit).toBe(1);
    expect(events.slice(-3)).toEqual(["sign:audio", "sign:portrait", `submit:${providerKind}`]);
  });

  it("signs only audio for a Lingmou template without a portrait variable", async () => {
    const calls = counters();
    const events: string[] = [];
    const deps = dependencies(calls, events);
    deps.inspectConfiguration = async () => {
      calls.inspect += 1;
      return {
        configured: true,
        safeCode: "CONFIG_VALID",
        requiresPortrait: false
      };
    };

    const result = await runDigitalHumanVideoDiagnostic({
      mode: "PAID",
      providerKind: "LINGMOU_BROADCAST",
      confirmPaidRequest: true
    }, "admin-1", deps);

    expect(result.billingOperations).toEqual([
      "ALIBABA_TTS_SYNTHESIS",
      "LINGMOU_BROADCAST_SUBMISSION"
    ]);
    expect(events).toContain("prepare:without-portrait");
    expect(events).toContain("sign:audio");
    expect(events).not.toContain("sign:portrait");
    expect(calls.sign).toBe(1);
  });

  it("passes the audio-only diagnostic through the real Lingmou local validator", async () => {
    const snapshot = configurationSnapshot("LINGMOU_ONLY");
    let variables: unknown = null;
    const provider = createLingmouBroadcastProvider(snapshot.models["lingmou-model"], {
      readConfigSecret: () => "diagnostics-local-secret",
      createClient: () => ({
        getBroadcastTemplate: async () => undefined,
        createBroadcastVideoFromTemplate: async (request) => {
          variables = request.variables;
          return {
            body: {
              success: true,
              requestId: "44444444-4444-4444-8444-444444444444",
              data: { id: "video-1" }
            }
          };
        },
        listBroadcastVideosById: async () => undefined
      })
    });
    const calls = counters();
    const deps = dependencies(calls);
    deps.inspectConfiguration = async () => ({
      configured: true,
      safeCode: "CONFIG_VALID",
      requiresPortrait: false
    });
    deps.prepareAssets = async (_provider, _actor, requiresPortrait) => {
      expect(requiresPortrait).toBe(false);
      calls.prepare += 1;
      return {
        audio: {
          objectKey: "media/audio/internal.wav",
          metadata: { contentType: "audio/wav", byteLength: 128, durationSeconds: 1 }
        },
        portrait: null
      };
    };
    deps.submitLingmou = (input) => provider.submit(input);

    const result = await runDigitalHumanVideoDiagnostic({
      mode: "PAID",
      providerKind: "LINGMOU_BROADCAST",
      confirmPaidRequest: true
    }, "admin-1", deps);

    expect(result).toMatchObject({ status: "REACHABLE", traceId: "44444444-4444-4444-8444-444444444444" });
    expect(variables).toEqual([
      expect.objectContaining({ name: "audio", type: "audio" })
    ]);
    expect(calls.sign).toBe(1);
  });

  it("maps untrusted error codes and trace IDs to safe provider fallbacks", async () => {
    const calls = counters();
    const deps = dependencies(calls);
    deps.submitEmo = async () => {
      calls.emo += 1;
      throw new MediaProviderError(
        "failed",
        "TONGYI",
        "SK_SECRET_IN_CODE",
        false,
        "sk-secret-in-trace"
      );
    };

    const result = await runDigitalHumanVideoDiagnostic({
      mode: "PAID",
      providerKind: "ALIBABA_EMO",
      confirmPaidRequest: true
    }, "admin-1", deps);

    expect(result.code).toBe("ALIBABA_EMO_DIAGNOSTIC_FAILED");
    expect(result.traceId).toBeNull();
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("does not report a paid submission as successful when audit persistence fails", async () => {
    const calls = counters();
    const deps = dependencies(calls);
    deps.saveAudit = async () => {
      calls.audit += 1;
      throw new Error("audit database unavailable");
    };

    await expect(runDigitalHumanVideoDiagnostic({
      mode: "PAID",
      providerKind: "LINGMOU_BROADCAST",
      confirmPaidRequest: true
    }, "admin-1", deps)).rejects.toThrow("audit database unavailable");
    expect(calls.lingmou).toBe(1);
    expect(calls.audit).toBe(1);
  });

  it("validates both providers for AUTO_RACE through only explicit local-data dependencies", async () => {
    const snapshot = configurationSnapshot("AUTO_RACE");
    const localDependencies = configurationDependencies(snapshot);
    const result = await inspectDigitalHumanVideoConfiguration(undefined, localDependencies);

    expect(result).toMatchObject({ configured: true, validatedProviders: [
      "LINGMOU_BROADCAST",
      "ALIBABA_EMO"
    ] });
    expect(Object.keys(localDependencies).sort()).toEqual([
      "findAsset",
      "findDefaultStorage",
      "findProfile",
      "findStorage",
      "loadRuntimeSettings",
      "now",
      "readConfigSecret",
      "resolveTtsModel",
      "resolveVideoModel"
    ]);
  });

  it.each([
    ["LINGMOU_ONLY", ["lingmou-model"]],
    ["EMO_ONLY", ["emo-model"]],
    ["AUTO_RACE", ["lingmou-model", "emo-model"]]
  ] as const)("validates only the providers selected by %s", async (mode, expectedModelIds) => {
    const snapshot = configurationSnapshot(mode);
    const resolvedModelIds: string[] = [];
    const result = await inspectDigitalHumanVideoConfiguration(undefined, {
      ...configurationDependencies(snapshot),
      resolveVideoModel: async (id) => {
        resolvedModelIds.push(id);
        return snapshot.models[id];
      }
    });

    expect(result.configured).toBe(true);
    expect(resolvedModelIds).toEqual(expectedModelIds);
  });

  it.each([
    ["unsupported MIME", { mimeType: "image/gif" }],
    ["empty bytes", { byteLength: 0 }],
    ["inactive asset", { cleanupStatus: "CLEANED" }],
    ["expired asset", { expiresAt: new Date("2026-07-31T00:00:00.000Z") }]
  ])("rejects an EMO portrait with %s locally", async (_name, assetOverride) => {
    const snapshot = configurationSnapshot("EMO_ONLY");
    Object.assign(snapshot.assets["portrait-1"], assetOverride);

    const result = await inspectDigitalHumanVideoConfiguration(undefined,
      configurationDependencies(snapshot));

    expect(result).toMatchObject({
      configured: false,
      validatedProviders: []
    });
  });

  it("rejects EMO dimensions outside 400-7000 and a disabled linked storage", async () => {
    const invalidDimensions = configurationSnapshot("EMO_ONLY");
    invalidDimensions.profiles["profile-1"].emoMappingJson = JSON.stringify({
      portraitWidth: 399,
      portraitHeight: 7001
    });
    const disabledStorage = configurationSnapshot("EMO_ONLY");
    disabledStorage.storages["storage-1"].enabled = false;

    await expect(Promise.all([
      inspectDigitalHumanVideoConfiguration(undefined, configurationDependencies(invalidDimensions)),
      inspectDigitalHumanVideoConfiguration(undefined, configurationDependencies(disabledStorage))
    ])).resolves.toEqual([
      expect.objectContaining({ configured: false }),
      expect.objectContaining({ configured: false })
    ]);
  });

  it("reuses the strict speech style validator and matches Lingmou template mapping", async () => {
    const badStyle = configurationSnapshot("LINGMOU_ONLY");
    badStyle.profiles["profile-1"].styleJson = JSON.stringify({ rawPrompt: "unsafe" });
    const badMapping = configurationSnapshot("LINGMOU_ONLY");
    badMapping.profiles["profile-1"].lingmouMappingJson = JSON.stringify({
      templateId: "different-template",
      audioVariableName: "audio",
      portraitVariableName: null
    });

    const results = await Promise.all([
      inspectDigitalHumanVideoConfiguration(undefined, configurationDependencies(badStyle)),
      inspectDigitalHumanVideoConfiguration(undefined, configurationDependencies(badMapping))
    ]);

    expect(results[0]).toMatchObject({
      configured: false,
      safeCode: "VIDEO_SPEECH_PROFILE_STYLE_INVALID"
    });
    expect(results[1].configured).toBe(false);
  });

  it("returns NOT_CONFIGURED without preparing or submitting paid assets", async () => {
    const calls = counters();
    const deps = dependencies(calls);
    deps.inspectConfiguration = async () => {
      calls.inspect += 1;
      return { configured: false, safeCode: "VIDEO_PROFILE_NOT_CONFIGURED" };
    };

    const result = await runDigitalHumanVideoDiagnostic({
      mode: "PAID",
      providerKind: "ALIBABA_EMO",
      confirmPaidRequest: true
    }, "admin-1", deps);

    expect(result).toMatchObject({
      status: "NOT_CONFIGURED",
      code: "VIDEO_PROFILE_NOT_CONFIGURED",
      traceId: null
    });
    expect(calls.prepare).toBe(0);
    expect(calls.lingmou).toBe(0);
    expect(calls.emo).toBe(0);
    expect(calls.audit).toBe(1);
  });

  it("redacts raw provider errors, credentials and signed URLs from result and audit", async () => {
    const apiKey = "sk-sensitive-api-key";
    const signedUrl = "https://signed.example/audio.wav?token=sensitive";
    const calls = counters();
    const audits: unknown[] = [];
    const deps = dependencies(calls);
    deps.createReadUrl = async () => {
      calls.sign += 1;
      return signedUrl;
    };
    deps.submitEmo = async () => {
      calls.emo += 1;
      throw new MediaProviderError(
        `upstream ${apiKey} ${signedUrl}`,
        "TONGYI",
        "ALIBABA_EMO_UPSTREAM_FAILED",
        true,
        "33333333-3333-4333-8333-333333333333"
      );
    };
    deps.saveAudit = async (audit) => {
      calls.audit += 1;
      audits.push(audit);
    };

    const result = await runDigitalHumanVideoDiagnostic({
      mode: "PAID",
      providerKind: "ALIBABA_EMO",
      confirmPaidRequest: true
    }, "admin-1", deps);

    expect(result).toEqual({
      status: "PROVIDER_ERROR",
      code: "ALIBABA_EMO_UPSTREAM_FAILED",
      providerKind: "ALIBABA_EMO",
      traceId: "33333333-3333-4333-8333-333333333333",
      checkedAt: "2026-08-01T00:00:00.000Z",
      billingOperations: [
        "ALIBABA_TTS_SYNTHESIS",
        "ALIBABA_EMO_FACE_DETECTION",
        "ALIBABA_EMO_VIDEO_SYNTHESIS"
      ],
      costSemantics: "POTENTIALLY_BILLABLE_OPERATIONS_COST_NOT_ESTIMATED"
    });
    expect(audits).toEqual([{
      actorId: "admin-1",
      providerKind: "ALIBABA_EMO",
      status: "PROVIDER_ERROR",
      safeCode: "ALIBABA_EMO_UPSTREAM_FAILED",
      traceId: "33333333-3333-4333-8333-333333333333",
      checkedAt: new Date("2026-08-01T00:00:00.000Z"),
      billingOperations: [
        "ALIBABA_TTS_SYNTHESIS",
        "ALIBABA_EMO_FACE_DETECTION",
        "ALIBABA_EMO_VIDEO_SYNTHESIS"
      ],
      costSemantics: "POTENTIALLY_BILLABLE_OPERATIONS_COST_NOT_ESTIMATED"
    }]);
    const serialized = JSON.stringify({ result, audits });
    expect(serialized).not.toContain(apiKey);
    expect(serialized).not.toContain(signedUrl);
    expect(serialized).not.toContain("upstream");
  });
});

function counters() {
  return { inspect: 0, prepare: 0, sign: 0, lingmou: 0, emo: 0, audit: 0 };
}

function dependencies(
  calls: ReturnType<typeof counters>,
  events: string[] = []
): DigitalHumanVideoDiagnosticDependencies {
  return {
    inspectConfiguration: async () => {
      calls.inspect += 1;
      return { configured: true, safeCode: "CONFIG_VALID", requiresPortrait: true };
    },
    prepareAssets: async (_providerKind, _actorId, requiresPortrait) => {
      calls.prepare += 1;
      events.push("prepare");
      events.push(requiresPortrait ? "prepare:with-portrait" : "prepare:without-portrait");
      return {
        audio: {
          objectKey: "media/audio/internal.wav",
          metadata: { contentType: "audio/wav", byteLength: 128, durationSeconds: 1 }
        },
        portrait: {
          objectKey: "media/portrait/internal.png",
          metadata: { contentType: "image/png", byteLength: 256, width: 1024, height: 1024 }
        }
      };
    },
    createReadUrl: async (asset) => {
      calls.sign += 1;
      const kind = asset.metadata.contentType.startsWith("audio/") ? "audio" : "portrait";
      events.push(`sign:${kind}`);
      return `https://signed.example/${kind}?opaque=1`;
    },
    submitLingmou: async (input) => {
      calls.lingmou += 1;
      events.push("submit:LINGMOU_BROADCAST");
      expect(input.audioUrl).toContain("signed.example/audio");
      return {
        upstreamTaskId: "lingmou-task",
        traceId: "11111111-1111-4111-8111-111111111111"
      };
    },
    submitEmo: async (input) => {
      calls.emo += 1;
      events.push("submit:ALIBABA_EMO");
      expect(input.portraitUrl).toContain("signed.example/portrait");
      return {
        upstreamTaskId: "emo-task",
        traceId: "22222222-2222-4222-8222-222222222222"
      };
    },
    saveAudit: async () => { calls.audit += 1; },
    now: () => new Date("2026-08-01T00:00:00.000Z")
  };
}

function configurationSnapshot(mode: "AUTO_RACE" | "LINGMOU_ONLY" | "EMO_ONLY") {
  const secret = "diagnostics-local-secret";
  const apiKeyEnvelope = encryptSecret("dashscope-key", secret);
  const lingmouEnvelope = encryptCredentialMap({
    accessKeyId: "access-key-id",
    accessKeySecret: "access-key-secret"
  }, secret);
  const ossEnvelope = encryptOssCredentials({
    accessKeyId: "oss-access-key-id",
    accessKeySecret: "oss-access-key-secret"
  }, secret);
  const tts = {
    capability: "TEXT_TO_SPEECH",
    providerId: "tts-provider",
    providerName: "TTS",
    providerType: "TONGYI",
    providerConfigVersion: 0,
    baseUrl: null,
    providerSettings: { workspaceId: "ws-main", region: "cn-beijing" },
    modelId: "tts-model",
    modelDisplayName: "TTS",
    modelName: "qwen-audio-3.0-tts-flash",
    modelSettings: { voice: "longanhuan" },
    temperature: 0,
    maxTokens: 0,
    timeoutMs: 30_000,
    credentialEnvelopes: { apiKey: apiKeyEnvelope, structured: null }
  } as never;
  const profile = {
    id: "profile-1",
    voice: "longanhuan",
    styleJson: "{}",
    lingmouMappingJson: JSON.stringify({
      templateId: "template-1",
      audioVariableName: "audio",
      portraitVariableName: null
    }),
    emoMappingJson: JSON.stringify({ portraitWidth: 1024, portraitHeight: 1024 }),
    portraitAssetId: "portrait-1",
    providerRole: "PRIMARY",
    enabled: true
  };
  return {
    settings: {
      mode,
      maxWaitMs: 8000,
      lingmouPollMs: [3000, 6000],
      emoPollMs: [8000],
      synchronizeProfiles: true,
      primaryProfileId: "profile-1",
      secondaryProfileId: "profile-1",
      lingmouModelId: "lingmou-model",
      emoModelId: "emo-model"
    } as never,
    tts,
    models: {
      "lingmou-model": {
        ...tts,
        capability: "DIGITAL_HUMAN_VIDEO",
        providerType: "LINGMOU",
        modelName: "lingmou-broadcast-video",
        modelSettings: {
          templateId: "template-1",
          audioVariableName: "audio",
          portraitVariableName: null,
          resolution: "1080p",
          fps: 25,
          watermark: false,
          mode: "audio"
        },
        credentialEnvelopes: { apiKey: null, structured: lingmouEnvelope }
      },
      "emo-model": {
        ...tts,
        capability: "DIGITAL_HUMAN_VIDEO",
        modelName: "emo-v1",
        modelSettings: { model: "emo-v1", ratio: "1:1", styleLevel: "normal" }
      }
    } as Record<string, never>,
    profiles: { "profile-1": profile } as Record<string, never>,
    assets: {
      "portrait-1": {
        id: "portrait-1",
        storageConfigId: "storage-1",
        mimeType: "image/png",
        byteLength: 1024,
        purpose: "PORTRAIT",
        cleanupStatus: "ACTIVE",
        expiresAt: new Date("2026-08-02T00:00:00.000Z")
      }
    } as Record<string, never>,
    storages: {
      "storage-1": {
        id: "storage-1",
        displayName: "OSS",
        providerKind: "ALI_OSS",
        endpoint: "oss-cn-beijing.aliyuncs.com",
        bucket: "private-bucket",
        region: "oss-cn-beijing",
        credentialsCiphertext: ossEnvelope.ciphertext,
        credentialsIv: ossEnvelope.iv,
        credentialsTag: ossEnvelope.tag,
        credentialsPreviewJson: null,
        enabled: true
      }
    } as Record<string, never>
  };
}

function configurationDependencies(
  snapshot: ReturnType<typeof configurationSnapshot>
): DigitalHumanVideoConfigurationDependencies {
  return {
    loadRuntimeSettings: async () => snapshot.settings,
    resolveTtsModel: async () => snapshot.tts,
    resolveVideoModel: async (id) => snapshot.models[id],
    findProfile: async (id) => snapshot.profiles[id],
    findAsset: async (id) => snapshot.assets[id],
    findStorage: async (id) => snapshot.storages[id],
    findDefaultStorage: async () => snapshot.storages["storage-1"],
    readConfigSecret: () => "diagnostics-local-secret",
    now: () => new Date("2026-08-01T00:00:00.000Z")
  };
}
