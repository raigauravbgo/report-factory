from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve .env relative to this file so it works regardless of cwd
_ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), extra="ignore")

    # Database
    database_url: str

    # S3
    s3_bucket: str
    s3_region: str = "us-east-1"
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""

    # AI — Flow 1 (Interview/Recipe)
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"
    azure_openai_endpoint: str = ""
    azure_openai_api_key: str = ""
    azure_openai_deployment: str = ""
    use_azure_openai: bool = False

    # AI — Flow 2 (ADK Agent)
    # adk_provider: "openai" uses LiteLLM + OPENAI_API_KEY (no extra key needed)
    #               "anthropic" uses Claude directly + ANTHROPIC_API_KEY
    adk_provider: str = "openai"
    adk_model: str = "gpt-4o-mini"
    anthropic_api_key: str = ""

    # App
    app_env: str = "development"
    max_upload_size_mb: int = 50

    # Cache — in-memory for MVP; set redis_url to enable Redis
    redis_url: str = ""


settings = Settings()
