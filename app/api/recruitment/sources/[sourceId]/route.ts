import { NextResponse } from "next/server";
import { postErrorResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { encryptRecruitmentSecret, getRecruitmentSecretPreview } from "@/lib/recruitment/crypto";
import {
  parseRecruitmentSourcePatchInput,
  serializeRecruitmentSource
} from "@/lib/validators/recruitment";

function sourceClient() {
  return (prisma as unknown as {
    recruitmentSource: {
      update(args: unknown): Promise<unknown>;
    };
  }).recruitmentSource;
}

export async function PATCH(request: Request, context: { params: Promise<{ sourceId: string }> }) {
  try {
    const { sourceId } = await context.params;
    const input = parseRecruitmentSourcePatchInput(await request.json());
    const data: Record<string, unknown> = {};

    if (input.displayName !== undefined) data.displayName = input.displayName;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.settings !== undefined) data.settingsJson = JSON.stringify(input.settings);
    if (input.verificationStatus !== undefined) data.verificationStatus = input.verificationStatus;
    if (input.apiKey !== undefined) {
      const envelope = encryptRecruitmentSecret(input.apiKey);
      data.credentialCiphertext = envelope.ciphertext;
      data.credentialIv = envelope.iv;
      data.credentialTag = envelope.tag;
      data.credentialPreview = getRecruitmentSecretPreview(input.apiKey);
    }
    if (input.sessionState !== undefined) {
      const envelope = encryptRecruitmentSecret(input.sessionState);
      data.sessionCiphertext = envelope.ciphertext;
      data.sessionIv = envelope.iv;
      data.sessionTag = envelope.tag;
      data.sessionPreview = "browser-session:stored";
    }

    const source = await sourceClient().update({
      where: { id: sourceId },
      data
    });

    return NextResponse.json({ source: serializeRecruitmentSource(source as never) });
  } catch (error) {
    return postErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ sourceId: string }> }) {
  try {
    const { sourceId } = await context.params;
    const source = await sourceClient().update({
      where: { id: sourceId },
      data: {
        enabled: false,
        credentialCiphertext: null,
        credentialIv: null,
        credentialTag: null,
        credentialPreview: null,
        sessionCiphertext: null,
        sessionIv: null,
        sessionTag: null,
        sessionPreview: null,
        verificationStatus: "UNVERIFIED"
      }
    });

    return NextResponse.json({ source: serializeRecruitmentSource(source as never) });
  } catch (error) {
    return postErrorResponse(error);
  }
}
