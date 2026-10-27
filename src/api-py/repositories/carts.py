from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_FLOOR, localcontext
from typing import Any
from uuid import UUID

import aiosqlite

from database.sqlite import get_connection
from models.cart import (
    AddCartItemRequest,
    Cart,
    CartItem,
    CheckoutReceipt,
    CheckoutRequest,
    UpdateCartItemRequest,
)
from utils.errors import (
    ConflictException, DatabaseException, NotFoundException, UnauthorizedException, ValidationException,
)


def normalize_cart_id(cart_id: str) -> str:
    try:
        return str(UUID(cart_id))
    except (ValueError, AttributeError) as error:
        raise ValidationException("cartId must be a UUID") from error


class CartsRepository:
    async def get_cart(self, cart_id: str, user_id: int | None = None) -> Cart:
        cart_id = normalize_cart_id(cart_id)
        async with get_connection() as connection:
            await connection.execute("BEGIN;")
            cart_row = await self._assert_access(connection, cart_id, user_id)
            items = await self._read_items(connection, cart_id)
        return self._cart_from_rows(cart_id, int(cart_row["version"]) if cart_row else 0, items)

    async def add_item(self, cart_id: str, request: AddCartItemRequest, user_id: int | None = None) -> Cart:
        cart_id = normalize_cart_id(cart_id)
        async with get_connection() as connection:
            await connection.execute("BEGIN IMMEDIATE;")
            try:
                await self._assert_access(connection, cart_id, user_id)
                await connection.execute(
                    "INSERT INTO carts (cart_id) VALUES (?) ON CONFLICT(cart_id) DO NOTHING;",
                    (cart_id,),
                )
                await self._get_product(connection, request.productId)
                existing_cursor = await connection.execute(
                    "SELECT quantity FROM cart_items WHERE cart_id = ? AND product_id = ?;",
                    (cart_id, request.productId),
                )
                existing = await existing_cursor.fetchone()
                quantity = int(existing["quantity"]) + request.quantity if existing else request.quantity
                if quantity > 999:
                    raise ValidationException("cart item quantity cannot exceed 999")
                await connection.execute(
                    """
                    INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)
                    ON CONFLICT(cart_id, product_id) DO UPDATE SET quantity = excluded.quantity;
                    """,
                    (cart_id, request.productId, quantity),
                )
                await self._increment_version(connection, cart_id)
                items = await self._read_items(connection, cart_id)
                version = await self._read_version(connection, cart_id)
                await connection.commit()
            except Exception:
                await connection.rollback()
                raise
        return self._cart_from_rows(cart_id, version, items)

    async def update_item(
        self, cart_id: str, product_id: int, request: UpdateCartItemRequest, user_id: int | None = None
    ) -> Cart:
        cart_id = normalize_cart_id(cart_id)
        _validate_product_id(product_id)
        async with get_connection() as connection:
            await connection.execute("BEGIN IMMEDIATE;")
            try:
                await self._assert_access(connection, cart_id, user_id)
                item_cursor = await connection.execute(
                    "SELECT 1 FROM cart_items WHERE cart_id = ? AND product_id = ?;",
                    (cart_id, product_id),
                )
                if not await item_cursor.fetchone():
                    raise NotFoundException("Cart item", product_id)
                await self._get_product(connection, product_id)
                await connection.execute(
                    "UPDATE cart_items SET quantity = ? WHERE cart_id = ? AND product_id = ?;",
                    (request.quantity, cart_id, product_id),
                )
                await self._increment_version(connection, cart_id)
                items = await self._read_items(connection, cart_id)
                version = await self._read_version(connection, cart_id)
                await connection.commit()
            except Exception:
                await connection.rollback()
                raise
        return self._cart_from_rows(cart_id, version, items)

    async def remove_item(self, cart_id: str, product_id: int, user_id: int | None = None) -> Cart:
        cart_id = normalize_cart_id(cart_id)
        _validate_product_id(product_id)
        async with get_connection() as connection:
            await connection.execute("BEGIN IMMEDIATE;")
            try:
                await self._assert_access(connection, cart_id, user_id)
                cursor = await connection.execute(
                    "DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?;",
                    (cart_id, product_id),
                )
                if cursor.rowcount == 0:
                    raise NotFoundException("Cart item", product_id)
                await self._increment_version(connection, cart_id)
                items = await self._read_items(connection, cart_id)
                version = await self._read_version(connection, cart_id)
                await connection.commit()
            except Exception:
                await connection.rollback()
                raise
        return self._cart_from_rows(cart_id, version, items)

    async def checkout(self, cart_id: str, request: CheckoutRequest, user_id: int) -> CheckoutReceipt:
        cart_id = normalize_cart_id(cart_id)
        async with get_connection() as connection:
            await connection.execute("BEGIN IMMEDIATE;")
            try:
                await self._assert_access(connection, cart_id, user_id)
                previous_cursor = await connection.execute(
                    """SELECT c.cart_id, c.receipt_json, o.user_id FROM cart_checkouts c
                    JOIN orders o ON o.order_id = c.order_id WHERE c.checkout_id = ?;""",
                    (request.checkoutId,),
                )
                previous = await previous_cursor.fetchone()
                if previous:
                    if previous["cart_id"] != cart_id:
                        raise ConflictException("checkoutId has already been used for another cart")
                    if previous["user_id"] != user_id:
                        raise NotFoundException("Checkout", request.checkoutId)
                    receipt = CheckoutReceipt.model_validate_json(previous["receipt_json"])
                    await connection.commit()
                    return receipt

                cart_cursor = await connection.execute(
                    "SELECT version FROM carts WHERE cart_id = ?;",
                    (cart_id,),
                )
                cart_row = await cart_cursor.fetchone()
                items = await self._read_items(connection, cart_id)
                if not items:
                    raise ConflictException("Cannot check out an empty cart")
                cart = self._cart_from_rows(
                    cart_id,
                    int(cart_row["version"]) if cart_row else 0,
                    items,
                )
                if cart.version != request.expectedVersion or cart.totalCents != request.expectedTotalCents:
                    raise ConflictException("Cart changed; refresh it before checking out")

                branch_cursor = await connection.execute(
                    "SELECT 1 FROM branches WHERE branch_id = ?;",
                    (request.branchId,),
                )
                if not await branch_cursor.fetchone():
                    raise NotFoundException("Branch", request.branchId)

                placed_at = datetime.now(timezone.utc).isoformat()
                description = json.dumps(request.delivery.model_dump(), separators=(",", ":"))
                order_cursor = await connection.execute(
                    """
                    INSERT INTO orders (branch_id, order_date, name, description, status, user_id)
                    VALUES (?, ?, ?, ?, 'pending', ?);
                    """,
                    (request.branchId, placed_at, request.delivery.name, description, user_id),
                )
                order_id = int(order_cursor.lastrowid)
                for item in cart.items:
                    await connection.execute(
                        """
                        INSERT INTO order_details (order_id, product_id, quantity, unit_price, notes)
                        VALUES (?, ?, ?, ?, '');
                        """,
                        (order_id, item.productId, item.quantity, item.unitPriceCents / 100),
                    )

                receipt = CheckoutReceipt(
                    checkoutId=request.checkoutId,
                    cartId=cart_id,
                    orderId=order_id,
                    placedAt=placed_at,
                    delivery=request.delivery,
                    items=cart.items,
                    totalCents=cart.totalCents,
                    itemCount=cart.itemCount,
                )
                await connection.execute(
                    """
                    INSERT INTO cart_checkouts (checkout_id, cart_id, order_id, receipt_json)
                    VALUES (?, ?, ?, ?);
                    """,
                    (request.checkoutId, cart_id, order_id, receipt.model_dump_json()),
                )
                await connection.execute("DELETE FROM cart_items WHERE cart_id = ?;", (cart_id,))
                await self._increment_version(connection, cart_id)
                await connection.commit()
                return receipt
            except Exception:
                await connection.rollback()
                raise

    async def get_checkout(self, cart_id: str, checkout_id: str, user_id: int) -> CheckoutReceipt:
        cart_id = normalize_cart_id(cart_id)
        checkout_id = normalize_cart_id(checkout_id)
        async with get_connection() as connection:
            await connection.execute("BEGIN;")
            await self._assert_access(connection, cart_id, user_id)
            cursor = await connection.execute(
                """
                SELECT c.receipt_json FROM cart_checkouts c JOIN orders o ON o.order_id = c.order_id
                WHERE c.checkout_id = ? AND c.cart_id = ? AND o.user_id = ?;
                """,
                (checkout_id, cart_id, user_id),
            )
            row = await cursor.fetchone()
        if not row:
            raise NotFoundException("Checkout", checkout_id)
        return CheckoutReceipt.model_validate_json(row["receipt_json"])

    async def order_history(self, user_id: int, order_id: int | None = None) -> list[CheckoutReceipt]:
        async with get_connection() as connection:
            cursor = await connection.execute(
                """SELECT c.receipt_json FROM cart_checkouts c JOIN orders o ON o.order_id = c.order_id
                WHERE o.user_id = ? AND (? IS NULL OR o.order_id = ?)
                ORDER BY o.order_date DESC, o.order_id DESC LIMIT 100;""",
                (user_id, order_id, order_id),
            )
            rows = await cursor.fetchall()
        return [CheckoutReceipt.model_validate_json(row["receipt_json"]) for row in rows]

    @staticmethod
    async def _assert_access(
        connection: aiosqlite.Connection, cart_id: str, user_id: int | None
    ) -> aiosqlite.Row | None:
        cursor = await connection.execute("SELECT * FROM carts WHERE cart_id = ?;", (cart_id,))
        row = await cursor.fetchone()
        if row:
            if row["merged_into"] is not None:
                raise NotFoundException("Cart", cart_id)
            if row["user_id"] is not None:
                if user_id is None:
                    raise UnauthorizedException()
                if row["user_id"] != user_id:
                    raise NotFoundException("Cart", cart_id)
        return row

    @staticmethod
    async def _get_product(connection: aiosqlite.Connection, product_id: int) -> aiosqlite.Row:
        cursor = await connection.execute(
            "SELECT product_id, name, img_name, price, discount FROM products WHERE product_id = ?;",
            (product_id,),
        )
        row = await cursor.fetchone()
        if not row:
            raise NotFoundException("Product", product_id)
        return row

    @classmethod
    async def _read_items(cls, connection: aiosqlite.Connection, cart_id: str) -> list[CartItem]:
        cursor = await connection.execute(
            """
            SELECT p.product_id, p.name, p.img_name, p.price, p.discount, ci.quantity
            FROM cart_items ci
            JOIN products p ON p.product_id = ci.product_id
            WHERE ci.cart_id = ?
            ORDER BY p.product_id;
            """,
            (cart_id,),
        )
        rows = await cursor.fetchall()
        items = []
        for row in rows:
            unit_price_cents = _unit_price_cents(row["price"], row["discount"])
            items.append(
                CartItem(
                    productId=row["product_id"],
                    name=row["name"],
                    imgName=row["img_name"],
                    quantity=row["quantity"],
                    unitPriceCents=unit_price_cents,
                    lineTotalCents=unit_price_cents * row["quantity"],
                )
            )
        return items

    @staticmethod
    async def _increment_version(connection: aiosqlite.Connection, cart_id: str) -> None:
        await connection.execute("UPDATE carts SET version = version + 1 WHERE cart_id = ?;", (cart_id,))

    @staticmethod
    async def _read_version(connection: aiosqlite.Connection, cart_id: str) -> int:
        cursor = await connection.execute("SELECT version FROM carts WHERE cart_id = ?;", (cart_id,))
        row = await cursor.fetchone()
        return int(row["version"])

    @staticmethod
    def _cart_from_rows(cart_id: str, version: int, items: list[CartItem]) -> Cart:
        return Cart(
            cartId=cart_id,
            version=version,
            items=items,
            totalCents=sum(item.lineTotalCents for item in items),
            itemCount=sum(item.quantity for item in items),
        )


def _validate_product_id(product_id: int) -> None:
    if isinstance(product_id, bool) or not isinstance(product_id, int) or product_id <= 0:
        raise ValidationException("productId must be a positive integer")


def _unit_price_cents(price: Any, discount: Any) -> int:
    try:
        parsed_price = Decimal(str(price))
        parsed_discount = Decimal(str(discount))
    except (InvalidOperation, TypeError, ValueError) as error:
        raise DatabaseException("Invalid product price or discount") from error
    if (
        not parsed_price.is_finite()
        or parsed_price < 0
        or not parsed_discount.is_finite()
        or not Decimal(0) <= parsed_discount <= Decimal(1)
    ):
        raise DatabaseException("Invalid product price or discount")
    with localcontext() as context:
        context.prec = 50
        cents = parsed_price * (Decimal(1) - parsed_discount) * 100 + Decimal("0.5")
        return int(cents.to_integral_value(rounding=ROUND_FLOOR))
