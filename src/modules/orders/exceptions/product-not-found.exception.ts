import { BaseVortexCommerceException } from 'src/common/exceptions/base-vortex-commerce-exception';

export class ProductNotFoundException extends BaseVortexCommerceException {
  constructor(productId: string) {
    super(`Produto com ID ${productId} não encontrado.`, 404);
  }
}
