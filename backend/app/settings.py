from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql://tcp:tcp_dev_only@localhost:5432/tcp"
    cors_origins: str = "http://localhost:5173,http://localhost:8080"
    port: int = Field(default=8000, ge=1, le=65535)
    session_max_age_seconds: int = 86400
    session_cookie_secure: bool = False
    demo_passwords_json: str | None = Field(
        default=None, validation_alias="TCP_DEMO_PASSWORDS"
    )

    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [
            origin.strip() for origin in self.cors_origins.split(",") if origin.strip()
        ]


settings = Settings()
