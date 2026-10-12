import { BaseVortexCommerceException } from 'src/common/exceptions/base-vortex-commerce-exception';

export class ProductNotAvailableException extends BaseVortexCommerceException {
  constructor(productId: string) {
    super(`Produto com ID ${productId} não está disponível para venda.`, 409);
  }
}
