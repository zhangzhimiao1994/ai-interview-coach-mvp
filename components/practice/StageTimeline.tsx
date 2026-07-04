import { clsx } from "clsx";
import type { StagePlanItem } from "@/lib/domain/stages";

type StageTimelineProps = {
  stages: StagePlanItem[];
  currentStage?: string;
};

export function StageTimeline({ stages, currentStage }: StageTimelineProps) {
  const currentIndex = Math.max(
    0,
    stages.findIndex((stage) => stage.type === currentStage)
  );

  return (
    <ol className="grid gap-2">
      {stages.map((stage, index) => {
        const isCurrent = stage.type === currentStage;
        const isPast = index < currentIndex;

        return (
          <li
            key={stage.type}
            className={clsx(
              "rounded-md border px-3 py-2 text-sm",
              isCurrent
                ? "border-brand bg-blue-50 text-ink"
                : isPast
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-line bg-white text-muted"
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{stage.label}</span>
              <span className="shrink-0 text-xs">{stage.durationMinutes} min</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
