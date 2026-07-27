import type { RecruitmentConnector, RecruitmentFetch } from "@/lib/recruitment/connectors/base";
import { createAdzunaConnector } from "@/lib/recruitment/connectors/adzuna";
import { createGreenhouseConnector } from "@/lib/recruitment/connectors/greenhouse";
import { createJoobleConnector } from "@/lib/recruitment/connectors/jooble";
import { createLeverConnector } from "@/lib/recruitment/connectors/lever";
import { createUsaJobsConnector } from "@/lib/recruitment/connectors/usajobs";

export type DefaultRecruitmentConnectorOptions = {
  fetch?: RecruitmentFetch;
  secret?: string;
};

export function createDefaultRecruitmentConnectors(options: DefaultRecruitmentConnectorOptions = {}): RecruitmentConnector[] {
  return [
    createAdzunaConnector(options),
    createJoobleConnector(options),
    createGreenhouseConnector(options),
    createLeverConnector(options),
    createUsaJobsConnector(options)
  ];
}

export {
  createAdzunaConnector,
  createGreenhouseConnector,
  createJoobleConnector,
  createLeverConnector,
  createUsaJobsConnector
};
