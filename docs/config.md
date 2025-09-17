# LLM configuration

The agent uses an OpenAI-compatible chat completion endpoint for `llm.chat` tool calls. Configure the provider with environment variables before running the application or the CLI.

## Quick start

1. Copy the sample file:

   ```bash
   cp .env.example .env.local
   ```

2. Edit `.env.local` and provide your credentials.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `OPENAI_BASE_URL` | No | Base URL for the compatible API. Defaults to `https://api.openai.com/v1`. |
| `OPENAI_API_KEY` | Yes | API key used for authentication. |
| `OPENAI_MODEL` | Yes | Chat completion model name (e.g. `gpt-4o-mini`). |
| `OPENAI_ORG` | No | Optional organization or project identifier header supported by some providers. |

The server, CLI and tests automatically read values from `process.env`. Local development should use `.env.local`; CI can define the same variables in the pipeline secrets store.

If a required variable is missing, `llm.chat` returns a structured `ToolError` with the code `llm.config_error` and the agent run is aborted gracefully.
