import { BaseVortexCommerceException } from 'src/common/exceptions/base-vortex-commerce-exception';

export class OrderNotFoundException extends BaseVortexCommerceException {
  constructor(id: string) {
    super(`Pedido com ID ${id} não encontrado.`, 404);
  }
}
