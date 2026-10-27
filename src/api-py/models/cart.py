from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, StrictInt, StrictStr, field_validator


class CartItem(BaseModel):
    productId: int
    name: str
    imgName: str | None
    quantity: int
    unitPriceCents: int
    lineTotalCents: int


class Cart(BaseModel):
    cartId: str
    version: int
    items: list[CartItem]
    totalCents: int
    itemCount: int


class AddCartItemRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    productId: StrictInt
    quantity: StrictInt

    @field_validator("productId")
    @classmethod
    def product_id_is_positive(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("productId must be a positive integer")
        return value

    @field_validator("quantity")
    @classmethod
    def quantity_is_valid(cls, value: int) -> int:
        if not 1 <= value <= 999:
            raise ValueError("quantity must be between 1 and 999")
        return value


class UpdateCartItemRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    quantity: StrictInt

    @field_validator("quantity")
    @classmethod
    def quantity_is_valid(cls, value: int) -> int:
        if not 1 <= value <= 999:
            raise ValueError("quantity must be between 1 and 999")
        return value


class DeliveryDetails(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: StrictStr
    email: StrictStr
    address: StrictStr
    city: StrictStr
    postalCode: StrictStr
    country: StrictStr

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return cls._trimmed(value, "name", 200)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        value = cls._trimmed(value, "email", 254)
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
            raise ValueError("email must be valid")
        return value

    @field_validator("address")
    @classmethod
    def validate_address(cls, value: str) -> str:
        return cls._trimmed(value, "address", 500)

    @field_validator("city")
    @classmethod
    def validate_city(cls, value: str) -> str:
        return cls._trimmed(value, "city", 200)

    @field_validator("postalCode")
    @classmethod
    def validate_postal_code(cls, value: str) -> str:
        return cls._trimmed(value, "postalCode", 40)

    @field_validator("country")
    @classmethod
    def validate_country(cls, value: str) -> str:
        return cls._trimmed(value, "country", 100)

    @staticmethod
    def _trimmed(value: str, field: str, maximum: int) -> str:
        value = value.strip()
        if not value:
            raise ValueError(f"{field} is required")
        if len(value) > maximum:
            raise ValueError(f"{field} must be at most {maximum} characters")
        return value


class CheckoutRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    checkoutId: StrictStr
    expectedVersion: StrictInt
    expectedTotalCents: StrictInt
    branchId: StrictInt
    delivery: DeliveryDetails

    @field_validator("checkoutId")
    @classmethod
    def checkout_id_is_uuid(cls, value: str) -> str:
        from uuid import UUID

        try:
            return str(UUID(value))
        except (ValueError, AttributeError) as error:
            raise ValueError("checkoutId must be a UUID") from error

    @field_validator("expectedVersion", "expectedTotalCents")
    @classmethod
    def expected_values_are_nonnegative(cls, value: int) -> int:
        if value < 0:
            raise ValueError("expected values must be nonnegative")
        return value

    @field_validator("branchId")
    @classmethod
    def branch_id_is_positive(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("branchId must be a positive integer")
        return value


class CheckoutReceipt(BaseModel):
    checkoutId: str
    cartId: str
    orderId: int
    placedAt: str
    delivery: DeliveryDetails
    items: list[CartItem]
    totalCents: int
    itemCount: int
