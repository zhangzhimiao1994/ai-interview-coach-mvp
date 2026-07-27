import { decryptRecruitmentSecret } from "@/lib/recruitment/crypto";
import type { ConnectorSource } from "@/lib/recruitment/connectors/base";

export function decryptSourceApiKey(source: ConnectorSource, secret?: string) {
  if (!source.credentialCiphertext || !source.credentialIv || !source.credentialTag) {
    throw Object.assign(new Error("RECRUITMENT_CONNECTOR_CREDENTIAL_REQUIRED"), { status: 401 });
  }

  return decryptRecruitmentSecret({
    ciphertext: source.credentialCiphertext,
    iv: source.credentialIv,
    tag: source.credentialTag
  }, secret);
}
