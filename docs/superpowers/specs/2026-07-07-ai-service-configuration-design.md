# AI Service Configuration Design

## Goal

Add an admin configuration center for AI service providers, models, and per-capability routing so the product is not locked to one AI vendor.

## Scope

This version provides a working configuration surface and database-backed routing metadata. It does not yet perform live calls to every vendor. The runtime continues to support the existing mock provider, and adds an OpenAI-compatible configuration shape that can later be used by DeepSeek, Tongyi, Volcano Ark, MiniMax, Azure OpenAI, and private OpenAI-compatible endpoints.

## Admin Capabilities

Administrators can manage:

- Service providers: display name, provider type, base URL, API key, enabled state.
- Models: model name, capability, temperature, max tokens, timeout, cost note, enabled state.
- Routing: one default model per AI capability.

Supported capabilities:

- Interview outline generation.
- Interview follow-up / questioning.
- Coaching report analysis.
- Speech-to-text.
- Text-to-speech.
- Digital human video.

## Secret Handling

API keys are encrypted before storage. The admin UI never renders the raw API key after save. It only shows a masked preview such as `sk-****abcd`.

Encryption uses `AI_CONFIG_SECRET` when available. In development and test, a fallback secret is allowed so the MVP remains easy to run. In production deployments, operators should set `AI_CONFIG_SECRET`.

## Data Model

Add:

- `AiServiceProvider`
- `AiModelConfig`

The model config belongs to a service provider. A model can be marked as the default for a capability. When a new default is created for a capability, existing defaults for the same capability are unset.

## Runtime Integration

`createConfiguredAiOrchestrator` will read active model config metadata. If the active model uses `MOCK`, it uses the current mock provider. OpenAI-compatible live calls are represented by configuration metadata in this version and remain safe until a concrete provider adapter is implemented.

## Testing

Add unit tests for:

- API key masking and encryption/decryption.
- Model default selection logic.
- Admin page rendering without exposing raw API keys.

Run full verification:

- `npm test`
- `npm run build`
- `npm run test:e2e`
