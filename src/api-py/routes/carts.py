from __future__ import annotations

from fastapi import APIRouter, Depends, status

from models.auth import User
from models.cart import (
    AddCartItemRequest,
    Cart,
    CheckoutReceipt,
    CheckoutRequest,
    UpdateCartItemRequest,
)
from repositories.carts import CartsRepository
from utils.auth import optional_user, require_user

router = APIRouter(prefix="/api/carts", tags=["Carts"])
repository = CartsRepository()


@router.get("/{cart_id}", response_model=Cart)
async def get_cart(cart_id: str, user: User | None = Depends(optional_user)) -> Cart:
    return await repository.get_cart(cart_id, user.userId if user else None)


@router.post("/{cart_id}/items", response_model=Cart)
async def add_item(
    cart_id: str, request: AddCartItemRequest, user: User | None = Depends(optional_user)
) -> Cart:
    return await repository.add_item(cart_id, request, user.userId if user else None)


@router.put("/{cart_id}/items/{product_id}", response_model=Cart)
async def update_item(
    cart_id: str, product_id: int, request: UpdateCartItemRequest, user: User | None = Depends(optional_user)
) -> Cart:
    return await repository.update_item(cart_id, product_id, request, user.userId if user else None)


@router.delete("/{cart_id}/items/{product_id}", response_model=Cart)
async def delete_item(cart_id: str, product_id: int, user: User | None = Depends(optional_user)) -> Cart:
    return await repository.remove_item(cart_id, product_id, user.userId if user else None)


@router.post("/{cart_id}/checkout", response_model=CheckoutReceipt, status_code=status.HTTP_201_CREATED)
async def checkout(
    cart_id: str, request: CheckoutRequest, user: User = Depends(require_user)
) -> CheckoutReceipt:
    return await repository.checkout(cart_id, request, user.userId)


@router.get("/{cart_id}/checkouts/{checkout_id}", response_model=CheckoutReceipt)
async def get_checkout(cart_id: str, checkout_id: str, user: User = Depends(require_user)) -> CheckoutReceipt:
    return await repository.get_checkout(cart_id, checkout_id, user.userId)
