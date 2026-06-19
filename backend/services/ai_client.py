import time as _time

from openai import AzureOpenAI, OpenAI

from core.config import settings


def chat_complete(
    messages: list[dict],
    temperature: float = 0.4,
    json_mode: bool = False,
    task_type: str = "unknown",
) -> str:
    """
    Route to the configured LLM provider. Switch via LLM_PROVIDER in .env.

    task_type is optional metadata for llm_call_logs (e.g. "interview",
    "kpi_suggest", "section_build"). Callers that don't pass it get "unknown".
    """
    provider = settings.llm_provider.lower()

    if provider == "anthropic":
        model_name = settings.anthropic_model
    elif provider == "azure" or (provider not in ("openai", "anthropic") and settings.use_azure_openai):
        model_name = settings.azure_openai_deployment
    else:
        model_name = settings.openai_model

    prompt_text = " ".join(str(m.get("content", "")) for m in messages)
    t0 = _time.time()
    result = ""
    try:
        if provider == "anthropic":
            result = _anthropic_complete(messages, temperature, json_mode)
        elif provider == "azure" or (provider not in ("openai", "anthropic") and settings.use_azure_openai):
            result = _azure_openai_complete(messages, temperature, json_mode)
        else:
            result = _openai_complete(messages, temperature, json_mode)

        _log(provider, model_name, task_type, prompt_text, result, t0, "success")
        return result
    except Exception as exc:
        _log(provider, model_name, task_type, prompt_text, "", t0, "error", str(exc))
        raise


def _log(provider, model, task_type, prompt, response, t0, status, error=None):
    """Fire-and-forget LLM call log. Never raises."""
    try:
        from services.observability import log_llm_call
        log_llm_call(
            provider=provider,
            model=model,
            task_type=task_type,
            prompt=prompt,
            response=response,
            latency_ms=int((_time.time() - t0) * 1000),
            status=status,
            error_message=error,
        )
    except Exception:
        pass


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
