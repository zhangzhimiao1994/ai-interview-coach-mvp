export type MediaErrorOptions = {
  provider?: string;
  code?: string;
  retryable?: boolean;
};

export class MediaConfigurationError extends Error {
  readonly provider?: string;
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, options: MediaErrorOptions = {}) {
    super(message);
    this.name = "MediaConfigurationError";
    this.provider = options.provider;
    this.code = options.code ?? "MEDIA_CONFIGURATION_ERROR";
    this.retryable = options.retryable ?? false;
  }
}

export class MediaProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly code = "MEDIA_PROVIDER_ERROR",
    readonly retryable = false
  ) {
    super(message);
    this.name = "MediaProviderError";
  }
}
