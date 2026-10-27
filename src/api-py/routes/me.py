from __future__ import annotations

from fastapi import APIRouter, Depends

from models.auth import User
from models.cart import CheckoutReceipt
from repositories.carts import CartsRepository
from utils.auth import require_user
from utils.errors import NotFoundException

router = APIRouter(
    prefix="/api/me", tags=["My orders"], responses={401: {"description": "Sign in is required"}},
)
repository = CartsRepository()


@router.get("/orders", response_model=list[CheckoutReceipt], summary="List your latest 100 checkout receipts")
async def orders(user: User = Depends(require_user)) -> list[CheckoutReceipt]:
    return await repository.order_history(user.userId)


@router.get(
    "/orders/{order_id}", response_model=CheckoutReceipt,
    responses={404: {"description": "No receipt belongs to this user and order"}},
)
async def order(order_id: int, user: User = Depends(require_user)) -> CheckoutReceipt:
    receipts = await repository.order_history(user.userId, order_id)
    if not receipts:
        raise NotFoundException("Order", order_id)
    return receipts[0]
