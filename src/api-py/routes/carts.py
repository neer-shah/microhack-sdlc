from __future__ import annotations

from fastapi import APIRouter, status

from models.cart import (
    AddCartItemRequest,
    Cart,
    CheckoutReceipt,
    CheckoutRequest,
    UpdateCartItemRequest,
)
from repositories.carts import CartsRepository

router = APIRouter(prefix="/api/carts", tags=["Carts"])
repository = CartsRepository()


@router.get("/{cart_id}", response_model=Cart)
async def get_cart(cart_id: str) -> Cart:
    return await repository.get_cart(cart_id)


@router.post("/{cart_id}/items", response_model=Cart)
async def add_item(cart_id: str, request: AddCartItemRequest) -> Cart:
    return await repository.add_item(cart_id, request)


@router.put("/{cart_id}/items/{product_id}", response_model=Cart)
async def update_item(cart_id: str, product_id: int, request: UpdateCartItemRequest) -> Cart:
    return await repository.update_item(cart_id, product_id, request)


@router.delete("/{cart_id}/items/{product_id}", response_model=Cart)
async def delete_item(cart_id: str, product_id: int) -> Cart:
    return await repository.remove_item(cart_id, product_id)


@router.post("/{cart_id}/checkout", response_model=CheckoutReceipt, status_code=status.HTTP_201_CREATED)
async def checkout(cart_id: str, request: CheckoutRequest) -> CheckoutReceipt:
    return await repository.checkout(cart_id, request)


@router.get("/{cart_id}/checkouts/{checkout_id}", response_model=CheckoutReceipt)
async def get_checkout(cart_id: str, checkout_id: str) -> CheckoutReceipt:
    return await repository.get_checkout(cart_id, checkout_id)
