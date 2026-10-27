from __future__ import annotations

from fastapi import Depends, Request

from models.auth import User
from repositories.auth import COOKIE_NAME, AuthRepository
from utils.errors import ForbiddenException, UnauthorizedException

repository = AuthRepository()


async def optional_user(request: Request) -> User | None:
    return await repository.session_user(request.cookies.get(COOKIE_NAME))


async def require_user(user: User | None = Depends(optional_user)) -> User:
    if user is None:
        raise UnauthorizedException()
    return user


async def require_admin(user: User = Depends(require_user)) -> User:
    if user.role != "admin":
        raise ForbiddenException()
    return user
