from __future__ import annotations

import os


def configure_openai_from_openrouter_env() -> None:
    """Let OpenRouter credentials work with OpenAI-compatible clients.

    PydanticAI's OpenAI provider reads `OPENAI_API_KEY` and `OPENAI_BASE_URL`.
    Many users prefer setting `OPENROUTER_API_KEY`; we map it automatically.
    """

    openrouter_key = os.getenv("OPENROUTER_API_KEY")
    if openrouter_key and not os.getenv("OPENAI_API_KEY"):
        os.environ["OPENAI_API_KEY"] = openrouter_key


def resolve_model(
    *,
    explicit: str | None,
    env_fallbacks: tuple[str, ...],
    default: str,
) -> str:
    """Resolve a PydanticAI model name.

    - If the selected value contains a provider prefix (e.g. `deepseek:` / `openai:`), use it.
    - Otherwise assume OpenAI-compatible and prefix with `openai:`.

    Examples:
    - `google/gemini-3-flash-preview` -> `openai:google/gemini-3-flash-preview`
    - `deepseek:deepseek-chat` -> unchanged
    """

    candidates: list[str] = []
    if explicit and explicit.strip():
        candidates.append(explicit.strip())

    for key in env_fallbacks:
        value = os.getenv(key)
        if value and value.strip():
            candidates.append(value.strip())

    selected = candidates[0] if candidates else default
    if ":" not in selected:
        selected = f"openai:{selected}"
    return selected
