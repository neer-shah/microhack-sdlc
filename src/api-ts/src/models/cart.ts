/**
 * @swagger
 * components:
 *   schemas:
 *     CartItem:
 *       type: object
 *       required: [productId, name, imgName, quantity, unitPriceCents, lineTotalCents]
 *       properties:
 *         productId: { type: integer }
 *         name: { type: string }
 *         imgName: { type: string, nullable: true }
 *         quantity: { type: integer, minimum: 1, maximum: 999 }
 *         unitPriceCents: { type: integer, minimum: 0 }
 *         lineTotalCents: { type: integer, minimum: 0 }
 *     Cart:
 *       type: object
 *       required: [cartId, version, items, totalCents, itemCount]
 *       properties:
 *         cartId: { type: string, format: uuid }
 *         version: { type: integer, minimum: 0 }
 *         items:
 *           type: array
 *           items: { $ref: '#/components/schemas/CartItem' }
 *         totalCents: { type: integer, minimum: 0 }
 *         itemCount: { type: integer, minimum: 0 }
 *     DeliveryDetails:
 *       type: object
 *       additionalProperties: false
 *       required: [name, email, address, city, postalCode, country]
 *       properties:
 *         name: { type: string, minLength: 1, maxLength: 120 }
 *         email: { type: string, format: email, maxLength: 254 }
 *         address: { type: string, minLength: 1, maxLength: 500 }
 *         city: { type: string, minLength: 1, maxLength: 120 }
 *         postalCode: { type: string, minLength: 1, maxLength: 32 }
 *         country: { type: string, minLength: 1, maxLength: 120 }
 *     CheckoutRequest:
 *       type: object
 *       additionalProperties: false
 *       required: [checkoutId, expectedVersion, expectedTotalCents, branchId, delivery]
 *       properties:
 *         checkoutId: { type: string, format: uuid }
 *         expectedVersion: { type: integer, minimum: 0 }
 *         expectedTotalCents: { type: integer, minimum: 0 }
 *         branchId: { type: integer, minimum: 1 }
 *         delivery: { $ref: '#/components/schemas/DeliveryDetails' }
 *     CheckoutReceipt:
 *       type: object
 *       required: [checkoutId, cartId, orderId, placedAt, delivery, items, totalCents, itemCount]
 *       properties:
 *         checkoutId: { type: string, format: uuid }
 *         cartId: { type: string, format: uuid }
 *         orderId: { type: integer }
 *         placedAt: { type: string, format: date-time }
 *         delivery: { $ref: '#/components/schemas/DeliveryDetails' }
 *         items:
 *           type: array
 *           items: { $ref: '#/components/schemas/CartItem' }
 *         totalCents: { type: integer, minimum: 0 }
 *         itemCount: { type: integer, minimum: 0 }
 */
export interface CartItem {
  productId: number;
  name: string;
  imgName: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface Cart {
  cartId: string;
  version: number;
  items: CartItem[];
  totalCents: number;
  itemCount: number;
}

export interface DeliveryDetails {
  name: string;
  email: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
}

export interface CheckoutRequest {
  checkoutId: string;
  expectedVersion: number;
  expectedTotalCents: number;
  branchId: number;
  delivery: DeliveryDetails;
}

export interface CheckoutReceipt {
  checkoutId: string;
  cartId: string;
  orderId: number;
  placedAt: string;
  delivery: DeliveryDetails;
  items: CartItem[];
  totalCents: number;
  itemCount: number;
}
