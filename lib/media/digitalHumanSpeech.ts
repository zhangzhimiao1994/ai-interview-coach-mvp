import { NextResponse } from "next/server";

type DisabledLegacySpeechDependencies = {
  findSession: (...args: never[]) => unknown;
  consumeRateLimit: (...args: never[]) => unknown;
  resolveModel: (...args: never[]) => unknown;
  synthesize: (...args: never[]) => unknown;
  logCall: (...args: never[]) => unknown;
  now: (...args: never[]) => unknown;
};

export function createDigitalHumanSpeechHandler(
  _overrides: Partial<DisabledLegacySpeechDependencies> = {}
) {
  void _overrides;
  return async function handleDisabledLegacyDigitalHumanSpeech(
    _request: Request
  ) {
    void _request;
    return NextResponse.json(
      {
        mode: "BROWSER_TTS_FALLBACK",
        reasonCode: "DIGITAL_HUMAN_SESSION_REQUIRED"
      },
      {
        status: 410,
        headers: { "Cache-Control": "no-store" }
      }
    );
  };
}
