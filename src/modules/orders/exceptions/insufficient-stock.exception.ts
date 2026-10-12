import { BaseVortexCommerceException } from 'src/common/exceptions/base-vortex-commerce-exception';

export class InsufficientStockException extends BaseVortexCommerceException {
  constructor(productId: string, requested: number, available: number) {
    super(
      `Estoque insuficiente para o produto ${productId}. Solicitado: ${requested}; disponível: ${available}.`,
      409,
    );
  }
}
