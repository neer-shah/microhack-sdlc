from __future__ import annotations

from fastapi import APIRouter, Depends

from models.auth import User
from models.order import CreateOrderRequest, Order, UpdateOrderRequest
from repositories.orders import OrdersRepository
from utils.auth import require_admin, require_user
from utils.errors import NotFoundException, ValidationException

router = APIRouter(prefix="/api/orders", tags=["Orders"])
repository = OrdersRepository()


@router.get("", response_model=list[Order])
async def get_all(user: User = Depends(require_user)) -> list[Order]:
    return await repository.find_all(None if user.role == "admin" else user.userId)


@router.get("/{order_id}", response_model=Order)
async def get_by_id(order_id: int, user: User = Depends(require_user)) -> Order:
    order = await repository.find_by_id(order_id, None if user.role == "admin" else user.userId)
    if order is None:
        raise NotFoundException("Order", order_id)
    return order


@router.post("", response_model=Order, status_code=201, dependencies=[Depends(require_admin)])
async def create(request: CreateOrderRequest) -> Order:
    if not request.name.strip():
        raise ValidationException("name is required")
    if request.branchId <= 0:
        raise ValidationException("branchId is required")
    if not request.orderDate.strip():
        raise ValidationException("orderDate is required")
    return await repository.create(request)


@router.put("/{order_id}", response_model=Order, dependencies=[Depends(require_admin)])
async def update(order_id: int, request: UpdateOrderRequest) -> Order:
    return await repository.update(order_id, request)


@router.delete("/{order_id}", status_code=204, dependencies=[Depends(require_admin)])
async def delete(order_id: int) -> None:
    await repository.delete(order_id)
