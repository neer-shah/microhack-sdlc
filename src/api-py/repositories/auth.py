from __future__ import annotations

import asyncio
import hashlib
import hmac
import secrets
import time
from datetime import datetime, timezone
from uuid import uuid4

import aiosqlite

from database.sqlite import get_connection
from models.auth import AuthResponse, LoginRequest, RegisterRequest, User
from utils.errors import (
    ConflictException,
    NotFoundException,
    TooManyRequestsException,
    UnauthorizedException,
)

SESSION_SECONDS = 604800
COOKIE_NAME = "octocat_session"
_DUMMY_HASH = "scrypt$" + "00" * 16 + "$" + "00" * 64


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=64)
    return f"scrypt${salt.hex()}${derived.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, salt_hex, derived_hex = encoded.split("$")
        salt, expected = bytes.fromhex(salt_hex), bytes.fromhex(derived_hex)
        if algorithm != "scrypt" or len(salt) != 16 or len(expected) != 64:
            raise ValueError("Invalid password encoding")
    except (ValueError, TypeError):
        salt, expected = bytes(16), bytes(64)
        valid_encoding = False
    else:
        valid_encoding = True
    actual = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=64)
    return hmac.compare_digest(actual, expected) and valid_encoding


def _user(row: aiosqlite.Row) -> User:
    return User(userId=row["user_id"], name=row["name"], email=row["email"], role=row["role"])


class AuthRepository:
    async def register(self, request: RegisterRequest) -> tuple[AuthResponse, str]:
        encoded = await asyncio.to_thread(hash_password, request.password)
        async with get_connection() as connection:
            await connection.execute("BEGIN IMMEDIATE;")
            try:
                try:
                    cursor = await connection.execute(
                        """INSERT INTO users (name, email, password_hash, role, created_at)
                        VALUES (?, ?, ?, 'customer', ?);""",
                        (request.name, request.email, encoded, datetime.now(timezone.utc).isoformat()),
                    )
                except aiosqlite.IntegrityError as error:
                    raise ConflictException("An account already exists for this email") from error
                user = User(userId=int(cursor.lastrowid), name=request.name, email=request.email, role="customer")
                cart_id = await self._owned_cart(connection, user.userId)
                await self._merge_cart(connection, request.guestCartId, cart_id)
                token = await self._create_session(connection, user.userId)
                await connection.commit()
            except Exception:
                await connection.rollback()
                raise
        return AuthResponse(user=user, cartId=cart_id), token

    async def login(self, request: LoginRequest, host: str) -> tuple[AuthResponse, str]:
        attempt_key = token_hash(request.email + "|" + host)
        async with get_connection() as connection:
            # Serializes the persistent throttle and merge across processes.
            await connection.execute("BEGIN IMMEDIATE;")
            try:
                now = int(time.time())
                cursor = await connection.execute(
                    "SELECT attempts, window_start FROM auth_attempts WHERE attempt_key = ?;",
                    (attempt_key,),
                )
                attempt = await cursor.fetchone()
                active = attempt is not None and now - attempt["window_start"] < 900
                if active and attempt["attempts"] >= 10:
                    raise TooManyRequestsException()
                cursor = await connection.execute("SELECT * FROM users WHERE email = ?;", (request.email,))
                row = await cursor.fetchone()
                valid = await asyncio.to_thread(
                    verify_password, request.password, row["password_hash"] if row else _DUMMY_HASH
                )
                if row is None or not valid:
                    await connection.execute(
                        """INSERT INTO auth_attempts (attempt_key, attempts, window_start) VALUES (?, ?, ?)
                        ON CONFLICT(attempt_key) DO UPDATE SET
                        attempts = excluded.attempts, window_start = excluded.window_start;""",
                        (
                            attempt_key,
                            attempt["attempts"] + 1 if active else 1,
                            attempt["window_start"] if active else now,
                        ),
                    )
                    await connection.commit()
                    raise UnauthorizedException("Invalid email or password")
                user = _user(row)
                cart_id = await self._owned_cart(connection, user.userId)
                await self._merge_cart(connection, request.guestCartId, cart_id)
                token = await self._create_session(connection, user.userId)
                await connection.execute("DELETE FROM auth_attempts WHERE attempt_key = ?;", (attempt_key,))
                await connection.commit()
            except Exception:
                await connection.rollback()
                raise
        return AuthResponse(user=user, cartId=cart_id), token

    async def session_user(self, token: str | None) -> User | None:
        if not token or len(token) != 64:
            return None
        async with get_connection() as connection:
            cursor = await connection.execute(
                """SELECT u.* FROM users u JOIN auth_sessions s ON s.user_id = u.user_id
                WHERE s.token_hash = ? AND s.expires_at > ?;""",
                (token_hash(token), int(time.time())),
            )
            row = await cursor.fetchone()
        return _user(row) if row else None

    async def me(self, user: User) -> AuthResponse:
        async with get_connection() as connection:
            await connection.execute("BEGIN IMMEDIATE;")
            try:
                cart_id = await self._owned_cart(connection, user.userId)
                await connection.commit()
            except Exception:
                await connection.rollback()
                raise
        return AuthResponse(user=user, cartId=cart_id)

    async def logout(self, token: str | None) -> None:
        if token:
            async with get_connection() as connection:
                await connection.execute("DELETE FROM auth_sessions WHERE token_hash = ?;", (token_hash(token),))
                await connection.commit()

    @staticmethod
    async def _owned_cart(connection: aiosqlite.Connection, user_id: int) -> str:
        cursor = await connection.execute(
            "SELECT cart_id FROM carts WHERE user_id = ? AND merged_into IS NULL;", (user_id,)
        )
        row = await cursor.fetchone()
        if row:
            return row["cart_id"]
        cart_id = str(uuid4())
        await connection.execute("INSERT INTO carts (cart_id, user_id) VALUES (?, ?);", (cart_id, user_id))
        return cart_id

    @staticmethod
    async def _merge_cart(connection: aiosqlite.Connection, source_id: str | None, destination_id: str) -> None:
        if source_id is None:
            return
        cursor = await connection.execute("SELECT * FROM carts WHERE cart_id = ?;", (source_id,))
        source = await cursor.fetchone()
        if not source:
            return
        if source["user_id"] is not None:
            raise NotFoundException("Cart", source_id)
        if source["merged_into"] is not None:
            if source["merged_into"] == destination_id:
                return
            raise NotFoundException("Cart", source_id)
        cursor = await connection.execute(
            """SELECT 1 FROM cart_items s LEFT JOIN cart_items d
            ON d.cart_id = ? AND d.product_id = s.product_id
            WHERE s.cart_id = ? AND s.quantity + COALESCE(d.quantity, 0) > 999;""",
            (destination_id, source_id),
        )
        if await cursor.fetchone():
            raise ConflictException("Merged cart item quantity cannot exceed 999")
        await connection.execute(
            """INSERT INTO cart_items (cart_id, product_id, quantity)
            SELECT ?, product_id, quantity FROM cart_items WHERE cart_id = ?
            ON CONFLICT(cart_id, product_id) DO UPDATE SET quantity = cart_items.quantity + excluded.quantity;""",
            (destination_id, source_id),
        )
        await connection.execute("DELETE FROM cart_items WHERE cart_id = ?;", (source_id,))
        await connection.execute(
            "UPDATE carts SET merged_into = ?, version = version + 1 WHERE cart_id = ?;",
            (destination_id, source_id),
        )
        await connection.execute("UPDATE carts SET version = version + 1 WHERE cart_id = ?;", (destination_id,))

    @staticmethod
    async def _create_session(connection: aiosqlite.Connection, user_id: int) -> str:
        token = secrets.token_hex(32)
        await connection.execute(
            "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?);",
            (token_hash(token), user_id, int(time.time()) + SESSION_SECONDS),
        )
        return token
