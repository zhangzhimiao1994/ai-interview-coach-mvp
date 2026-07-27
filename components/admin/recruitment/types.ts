export type RecruitmentSourceView = {
  id: string;
  provider: string;
  sourceType: string;
  displayName: string;
  enabled: boolean;
  credentialPreview?: string | null;
  sessionPreview?: string | null;
  verificationStatus: string;
};

export type RecruitmentTemplateView = {
  id: string;
  name: string;
  keywords: string;
  city?: string | null;
  country?: string | null;
  sourceIds?: string[];
  enabled: boolean;
};

export type RecruitmentPostingView = {
  id: string;
  title: string;
  company?: string | null;
  location?: string | null;
  provider: string;
  sourceUrl?: string | null;
  status?: string;
  updatedAt?: Date | string | null;
};

export type RecruitmentSyncRunView = {
  id: string;
  templateId?: string | null;
  sourceId?: string | null;
  mode: string;
  status: string;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  failureReason?: string | null;
  startedAt?: Date | string | null;
};
