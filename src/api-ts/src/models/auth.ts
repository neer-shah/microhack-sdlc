/**
 * @swagger
 * components:
 *   securitySchemes:
 *     CustomerSession:
 *       type: apiKey
 *       in: cookie
 *       name: octocat_session
 *   schemas:
 *     Customer:
 *       type: object
 *       required: [userId, name, email, role]
 *       properties:
 *         userId: { type: integer }
 *         name: { type: string }
 *         email: { type: string, format: email }
 *         role: { type: string, enum: [customer, admin] }
 *     AuthSession:
 *       type: object
 *       required: [user, cartId]
 *       properties:
 *         user: { $ref: '#/components/schemas/Customer' }
 *         cartId: { type: string, format: uuid }
 *     LoginCredentials:
 *       type: object
 *       additionalProperties: false
 *       required: [email, password]
 *       properties:
 *         email: { type: string, format: email, maxLength: 254 }
 *         password: { type: string, minLength: 12, maxLength: 128, writeOnly: true }
 *         guestCartId: { type: string, format: uuid }
 *     Registration:
 *       type: object
 *       additionalProperties: false
 *       required: [name, email, password]
 *       properties:
 *         name: { type: string, minLength: 1, maxLength: 120 }
 *         email: { type: string, format: email, maxLength: 254 }
 *         password: { type: string, minLength: 12, maxLength: 128, writeOnly: true }
 *         guestCartId: { type: string, format: uuid }
 */
export interface Customer {
  userId: number;
  name: string;
  email: string;
  role: 'customer' | 'admin';
}

export interface AuthSession {
  user: Customer;
  cartId: string;
}

export interface Credentials {
  email: string;
  password: string;
  name?: string;
  guestCartId?: string;
}
