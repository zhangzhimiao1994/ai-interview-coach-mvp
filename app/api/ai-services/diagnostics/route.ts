import { NextResponse } from "next/server";
import { postErrorResponse } from "@/lib/api/errors";
import {
  diagnoseAiCapability,
  getAllAiDiagnostics
} from "@/lib/ai/diagnostics";
import { parseAiDiagnosticRequest } from "@/lib/validators/aiDiagnostics";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ diagnostics: await getAllAiDiagnostics() });
  } catch (error) {
    return postErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = parseAiDiagnosticRequest(await request.json());
    const diagnostic = await diagnoseAiCapability(input.capability, {
      liveCheck: input.liveCheck
    });

    return NextResponse.json({ diagnostic });
  } catch (error) {
    return postErrorResponse(error);
  }
}
