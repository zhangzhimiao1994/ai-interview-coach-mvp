import { describe, expect, it, vi } from "vitest";
import {
  claimDueRecruitmentSchedules,
  computeNextRecruitmentRunAt,
  runDueRecruitmentSchedules
} from "@/lib/recruitment/sync";

describe("recruitment schedule foundation", () => {
  it("computes next run times from explicit frequencies", () => {
    const from = new Date("2026-07-27T12:00:00.000Z");

    expect(computeNextRecruitmentRunAt(from, "HOURLY").toISOString()).toBe("2026-07-27T13:00:00.000Z");
    expect(computeNextRecruitmentRunAt(from, "DAILY").toISOString()).toBe("2026-07-28T12:00:00.000Z");
    expect(computeNextRecruitmentRunAt(from, "WEEKLY").toISOString()).toBe("2026-08-03T12:00:00.000Z");
  });

  it("claims only enabled due schedules whose locks have expired", async () => {
    const now = new Date("2026-07-27T12:00:00.000Z");
    const schedules = [
      { id: "due-1", templateId: "template-1", frequency: "DAILY", enabled: true, nextRunAt: now, lockExpiresAt: null, template: { enabled: true } },
      { id: "disabled-template", templateId: "template-2", frequency: "DAILY", enabled: true, nextRunAt: now, lockExpiresAt: null, template: { enabled: false } },
      { id: "locked", templateId: "template-3", frequency: "DAILY", enabled: true, nextRunAt: now, lockExpiresAt: new Date("2026-07-27T12:10:00.000Z"), template: { enabled: true } }
    ];
    const prisma = {
      recruitmentSyncSchedule: {
        findMany: vi.fn().mockResolvedValue(schedules),
        updateMany: vi.fn().mockImplementation(({ where }) => Promise.resolve({ count: where.id === "due-1" ? 1 : 0 }))
      }
    };

    const claimed = await claimDueRecruitmentSchedules({ prisma, now: () => now });

    expect(claimed.map((schedule) => schedule.id)).toEqual(["due-1"]);
    expect(prisma.recruitmentSyncSchedule.updateMany).toHaveBeenCalledTimes(1);
  });

  it("runs claimed schedules explicitly without starting a background worker", async () => {
    const now = new Date("2026-07-27T12:00:00.000Z");
    const runRecruitmentSync = vi.fn().mockResolvedValue({ status: "SUCCESS" });
    const prisma = {
      recruitmentSyncSchedule: {
        findMany: vi.fn().mockResolvedValue([
          { id: "due-1", templateId: "template-1", frequency: "DAILY", enabled: true, nextRunAt: now, lockExpiresAt: null, template: { enabled: true } }
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({})
      }
    };

    const result = await runDueRecruitmentSchedules({ prisma, now: () => now, runRecruitmentSync });

    expect(result.startedCount).toBe(1);
    expect(runRecruitmentSync).toHaveBeenCalledWith(expect.objectContaining({ templateId: "template-1", mode: "MANUAL" }));
    expect(prisma.recruitmentSyncSchedule.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "due-1" },
      data: expect.objectContaining({ lockExpiresAt: null })
    }));
  });
});
