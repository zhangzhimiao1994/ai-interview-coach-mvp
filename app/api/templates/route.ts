import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const [companies, jobs, interviewers] = await Promise.all([
    prisma.companyTemplate.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.jobTemplate.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.interviewerTemplate.findMany({ orderBy: { createdAt: "desc" } })
  ]);

  return NextResponse.json({ companies, jobs, interviewers });
}
