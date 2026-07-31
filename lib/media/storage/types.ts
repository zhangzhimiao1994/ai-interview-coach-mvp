export type PrivateMediaPurpose = "PORTRAIT" | "TTS_AUDIO" | "VIDEO_OUTPUT";

export interface PrivateMediaStorage {
  putObject(input: {
    purpose: PrivateMediaPurpose;
    body: Buffer;
    contentType: string;
    expiresAt: Date;
  }): Promise<{ objectKey: string; byteLength: number }>;
  createReadUrl(objectKey: string, expiresInSeconds: number): Promise<string>;
  removeObject(objectKey: string): Promise<void>;
}

export type OssCredentials = {
  accessKeyId: string;
  accessKeySecret: string;
  securityToken?: string;
};

export type MediaStorageConfigRecord = {
  id: string;
  displayName: string;
  providerKind: string;
  endpoint: string;
  bucket: string;
  region: string | null;
  credentialsCiphertext: string | null;
  credentialsIv: string | null;
  credentialsTag: string | null;
  credentialsPreviewJson: string | null;
  enabled: boolean;
};
