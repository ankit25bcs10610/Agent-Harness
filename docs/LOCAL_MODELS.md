# Local model support

Chiku supports an explicitly configured local OpenAI-compatible HTTP endpoint.
It does not download model weights, install a runtime, scan the network, or
silently fall back to a cloud provider.

## Configure an endpoint

Set the endpoint and select a `local/` model reference:

```bash
export CHIKU_PROVIDER=local
export CHIKU_LOCAL_BASE_URL=http://127.0.0.1:11434/v1
export CHIKU_MODEL=local/my-model
bun run dev
```

The endpoint must be loopback (`localhost`, `127.0.0.1`, or `::1`) by default.
An HTTPS non-loopback endpoint requires both `CHIKU_LOCAL_ALLOW_REMOTE=true` and
`CHIKU_LOCAL_PRIVATE_ENDPOINT_CONSENT=true`. `CHIKU_OFFLINE=true` restricts the
endpoint to loopback even if remote flags are present.

An API key may be supplied through `CHIKU_LOCAL_API_KEY`. It is sent only as an
Authorization header and is not printed by diagnostics. Do not put credentials
in the endpoint URL.

Inspect the configured endpoint and conservative host facts without making a
network request:

```bash
bun src/index.tsx local-status
```

## Capability safety

The local `/models` response is discovery only. A model is not routable until
its capabilities are explicitly configured by the host application. Unknown
context limits, tool calling, structured output, reasoning, and streaming are
reported as unknown/unsupported rather than inferred from a model name.

The current adapter understands OpenAI-compatible `/v1/models` and
`/v1/chat/completions` responses, including non-streaming and SSE streaming
responses. Tool execution remains subject to Chiku's existing permission and
tool validation boundaries.

## What is not claimed

`local-status` reports GPU and accelerator support as `unknown`. Chiku does not
currently ship native MLX, llama.cpp, Ollama-specific, CUDA, Metal, or Core ML
backends, and it does not claim memory-fitting, quantization, thermal, or power
optimization. Those integrations require a separately verified backend and are
not enabled by guessing from the operating system.
