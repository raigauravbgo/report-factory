from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve .env relative to the project root regardless of cwd
_ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), extra="ignore")

    # Database (optional — SQLite dev.db used when not set)
    database_url: str = "sqlite:///./dev.db"

    # S3 (optional — local filesystem fallback when aws_access_key_id is empty)
    s3_bucket: str = "local"
    s3_region: str = "us-east-1"
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""

    # AI
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    azure_openai_endpoint: str = ""
    azure_openai_api_key: str = ""
    azure_openai_deployment: str = ""
    use_azure_openai: bool = False

    # App
    app_env: str = "development"
    max_upload_size_mb: int = 50

    # Storage paths
    session_storage_path: str = "./sessions"
    upload_storage_path: str = "./local_uploads"

    # Cache
    redis_url: str = ""


settings = Settings()
