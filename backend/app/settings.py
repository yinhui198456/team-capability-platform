from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql://tcp:tcp_dev_only@localhost:5432/tcp"
    cors_origins: str = "http://localhost:5173,http://localhost:8080"
    port: int = Field(default=8000, ge=1, le=65535)
    # Enables local UAT demo-account seeding when set; blank (default) disables
    # it. Must come from the environment; the repository provides no default.
    demo_seed_password: str = ""
    session_max_age_seconds: int = 86400
    session_cookie_secure: bool = False

    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [
            origin.strip() for origin in self.cors_origins.split(",") if origin.strip()
        ]


settings = Settings()
