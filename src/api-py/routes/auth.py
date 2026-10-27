from __future__ import annotations

import os

from fastapi import APIRouter, Depends, Request, Response

from models.auth import AuthResponse, LoginRequest, RegisterRequest, User
from repositories.auth import COOKIE_NAME, SESSION_SECONDS, AuthRepository
from utils.auth import require_user

router = APIRouter(
    prefix="/api/auth",
    tags=["Authentication"],
    responses={403: {"description": "Origin is not allowed"}},
)
repository = AuthRepository()


def _secure_cookie() -> bool:
    return os.getenv("NODE_ENV") == "production" or os.getenv("APP_ENV") == "production"


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        COOKIE_NAME, token, max_age=SESSION_SECONDS, path="/api",
        httponly=True, secure=_secure_cookie(), samesite="lax",
    )


@router.post(
    "/register", response_model=AuthResponse, status_code=201,
    responses={404: {"description": "Guest cart is not accessible"}, 409: {"description": "Email or cart conflict"}},
)
async def register(payload: RegisterRequest, response: Response) -> AuthResponse:
    result, token = await repository.register(payload)
    _set_cookie(response, token)
    return result


@router.post(
    "/login", response_model=AuthResponse,
    responses={
        401: {"description": "Invalid email or password"},
        404: {"description": "Guest cart is not accessible"},
        409: {"description": "Merged quantity exceeds 999"},
        429: {"description": "Too many failed login attempts"},
    },
)
async def login(payload: LoginRequest, request: Request, response: Response) -> AuthResponse:
    result, token = await repository.login(payload, request.client.host if request.client else "")
    _set_cookie(response, token)
    return result


@router.get("/me", response_model=AuthResponse, responses={401: {"description": "No active session"}})
async def me(user: User = Depends(require_user)) -> AuthResponse:
    return await repository.me(user)


@router.post("/logout", status_code=204)
async def logout(request: Request) -> Response:
    await repository.logout(request.cookies.get(COOKIE_NAME))
    response = Response(status_code=204)
    response.delete_cookie(
        COOKIE_NAME, path="/api", httponly=True, secure=_secure_cookie(), samesite="lax",
    )
    return response
