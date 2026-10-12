import { BaseVortexCommerceException } from 'src/common/exceptions/base-vortex-commerce-exception';

export class OrderCannotBeCancelledException extends BaseVortexCommerceException {
  constructor() {
    super('Somente pedidos pendentes podem ser cancelados.', 409);
  }
}
