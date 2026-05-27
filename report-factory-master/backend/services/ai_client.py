from openai import AzureOpenAI, OpenAI

from core.config import settings


def chat_complete(
    messages: list[dict],
    temperature: float = 0.4,
    json_mode: bool = False,
) -> str:
    if settings.use_azure_openai:
        client: AzureOpenAI | OpenAI = AzureOpenAI(
            api_key=settings.azure_openai_api_key,
            azure_endpoint=settings.azure_openai_endpoint,
            api_version="2024-02-15-preview",
        )
        model = settings.azure_openai_deployment
    else:
        client = OpenAI(api_key=settings.openai_api_key)
        model = settings.openai_model

    kwargs: dict = dict(model=model, messages=messages, temperature=temperature)
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}

    resp = client.chat.completions.create(**kwargs)
    return resp.choices[0].message.content or ""
