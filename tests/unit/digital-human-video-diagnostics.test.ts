import { describe, expect, it } from "vitest";
import { MediaProviderError } from "@/lib/media/errors";
import {
  DigitalHumanVideoDiagnosticInputError,
  runDigitalHumanVideoDiagnostic,
  type DigitalHumanVideoDiagnosticDependencies
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
      traceId: providerKind === "LINGMOU_BROADCAST" ? "trace-lingmou" : "trace-emo"
    });
    expect(calls.lingmou).toBe(expectedLingmou);
    expect(calls.emo).toBe(expectedEmo);
    expect(calls.prepare).toBe(1);
    expect(calls.sign).toBe(2);
    expect(calls.audit).toBe(1);
    expect(events.slice(-3)).toEqual(["sign:audio", "sign:portrait", `submit:${providerKind}`]);
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
        "trace-safe"
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
      traceId: "trace-safe",
      checkedAt: "2026-08-01T00:00:00.000Z"
    });
    expect(audits).toEqual([{
      actorId: "admin-1",
      providerKind: "ALIBABA_EMO",
      status: "PROVIDER_ERROR",
      safeCode: "ALIBABA_EMO_UPSTREAM_FAILED",
      traceId: "trace-safe",
      checkedAt: new Date("2026-08-01T00:00:00.000Z")
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
      return { configured: true, safeCode: "CONFIG_VALID" };
    },
    prepareAssets: async () => {
      calls.prepare += 1;
      events.push("prepare");
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
      return { upstreamTaskId: "lingmou-task", traceId: "trace-lingmou" };
    },
    submitEmo: async (input) => {
      calls.emo += 1;
      events.push("submit:ALIBABA_EMO");
      expect(input.portraitUrl).toContain("signed.example/portrait");
      return { upstreamTaskId: "emo-task", traceId: "trace-emo" };
    },
    saveAudit: async () => { calls.audit += 1; },
    now: () => new Date("2026-08-01T00:00:00.000Z")
  };
}
