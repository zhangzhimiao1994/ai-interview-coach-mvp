export class AiProviderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AiProviderError";
  }
}

export class AiStructuredOutputError extends AiProviderError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AiStructuredOutputError";
  }
}
