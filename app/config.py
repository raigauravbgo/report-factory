from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    openai_api_key: str = ""
    session_storage_path: str = "./sessions"
    upload_storage_path: str = "./uploads"
    max_file_size_mb: int = 50

    model_config = {"env_file": ".env"}


settings = Settings()

Path(settings.session_storage_path).mkdir(parents=True, exist_ok=True)
Path(settings.upload_storage_path).mkdir(parents=True, exist_ok=True)
