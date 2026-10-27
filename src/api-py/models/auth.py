from __future__ import annotations

import re
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, StrictStr, field_validator


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: StrictStr
    password: StrictStr
    guestCartId: StrictStr | None = None

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        if len(value) > 254 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
            raise ValueError("email must be valid and at most 254 characters")
        return value

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if not 12 <= len(value) <= 128:
            raise ValueError("password must be between 12 and 128 characters")
        return value

    @field_validator("guestCartId")
    @classmethod
    def validate_guest_cart(cls, value: str | None) -> str | None:
        if value is not None and str(UUID(value)) != value:
            raise ValueError("guestCartId must be a canonical UUID")
        return value


class RegisterRequest(LoginRequest):
    name: StrictStr

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        value = value.strip()
        if not 1 <= len(value) <= 120:
            raise ValueError("name must be between 1 and 120 characters")
        return value


class User(BaseModel):
    userId: int
    name: str
    email: str
    role: Literal["customer", "admin"]


class AuthResponse(BaseModel):
    user: User
    cartId: str
