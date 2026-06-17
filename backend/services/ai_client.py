from openai import AzureOpenAI, OpenAI

from core.config import settings


def chat_complete(
    messages: list[dict],
    temperature: float = 0.4,
    json_mode: bool = False,
) -> str:
    """Route to the configured LLM provider. Switch via LLM_PROVIDER in .env."""
    provider = settings.llm_provider.lower()

    if provider == "anthropic":
        return _anthropic_complete(messages, temperature, json_mode)
    elif provider == "azure" or (provider not in ("openai", "anthropic") and settings.use_azure_openai):
        # Explicit LLM_PROVIDER=openai takes priority over USE_AZURE_OPENAI flag
        return _azure_openai_complete(messages, temperature, json_mode)
    else:
        return _openai_complete(messages, temperature, json_mode)


def _openai_complete(messages: list[dict], temperature: float, json_mode: bool) -> str:
    client = OpenAI(api_key=settings.openai_api_key)
    kwargs: dict = dict(
        model=settings.openai_model,
        messages=messages,
        temperature=temperature,
    )
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    resp = client.chat.completions.create(**kwargs)
    if not resp.choices:
        raise ValueError("OpenAI returned an empty choices list")
    return resp.choices[0].message.content or ""


def _azure_openai_complete(messages: list[dict], temperature: float, json_mode: bool) -> str:
    client = AzureOpenAI(
        api_key=settings.azure_openai_api_key,
        azure_endpoint=settings.azure_openai_endpoint,
        api_version="2024-02-15-preview",
    )
    kwargs: dict = dict(
        model=settings.azure_openai_deployment,
        messages=messages,
        temperature=temperature,
    )
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    resp = client.chat.completions.create(**kwargs)
    if not resp.choices:
        raise ValueError("Azure OpenAI returned an empty choices list")
    return resp.choices[0].message.content or ""


def _anthropic_complete(messages: list[dict], temperature: float, json_mode: bool) -> str:
    from anthropic import Anthropic

    client = Anthropic(api_key=settings.anthropic_api_key)

    # Anthropic separates system prompt from the conversation messages array
    system = ""
    filtered: list[dict] = []
    for msg in messages:
        if msg["role"] == "system":
            system = msg["content"]
        else:
            filtered.append(msg)

    if json_mode:
        suffix = "\nRespond with valid JSON only. No markdown fences, no explanation."
        system = (system + suffix).strip()

    resp = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=4096,
        system=system,
        messages=filtered,
        temperature=temperature,
    )
    if not resp.content:
        raise ValueError("Anthropic returned an empty content list")
    return resp.content[0].text
