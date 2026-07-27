import { NextResponse } from "next/server";
import { postErrorResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { encryptRecruitmentSecret, getRecruitmentSecretPreview } from "@/lib/recruitment/crypto";
import {
  parseRecruitmentSourceInput,
  serializeRecruitmentSource
} from "@/lib/validators/recruitment";

function sourceClient() {
  return (prisma as unknown as {
    recruitmentSource: {
      findMany(args: unknown): Promise<unknown[]>;
      create(args: unknown): Promise<unknown>;
    };
  }).recruitmentSource;
}

export async function GET() {
  const sources = await sourceClient().findMany({
    orderBy: { createdAt: "desc" }
  });

  return NextResponse.json({ sources: sources.map((source) => serializeRecruitmentSource(source as never)) });
}

export async function POST(request: Request) {
  try {
    const input = parseRecruitmentSourceInput(await request.json());
    const credentialEnvelope = input.apiKey ? encryptRecruitmentSecret(input.apiKey) : null;
    const sessionEnvelope = input.sessionState ? encryptRecruitmentSecret(input.sessionState) : null;

    const source = await sourceClient().create({
      data: {
        provider: input.provider,
        sourceType: input.sourceType,
        displayName: input.displayName,
        enabled: input.enabled ?? true,
        credentialCiphertext: credentialEnvelope?.ciphertext || null,
        credentialIv: credentialEnvelope?.iv || null,
        credentialTag: credentialEnvelope?.tag || null,
        credentialPreview: input.apiKey ? getRecruitmentSecretPreview(input.apiKey) : null,
        sessionCiphertext: sessionEnvelope?.ciphertext || null,
        sessionIv: sessionEnvelope?.iv || null,
        sessionTag: sessionEnvelope?.tag || null,
        sessionPreview: input.sessionState ? "browser-session:stored" : null,
        verificationStatus: "UNVERIFIED",
        settingsJson: JSON.stringify(input.settings)
      }
    });

    return NextResponse.json({ source: serializeRecruitmentSource(source as never) }, { status: 201 });
  } catch (error) {
    return postErrorResponse(error);
  }
}
