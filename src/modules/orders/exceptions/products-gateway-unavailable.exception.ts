import { BaseVortexCommerceException } from 'src/common/exceptions/base-vortex-commerce-exception';

export class ProductsGatewayUnavailableException extends BaseVortexCommerceException {
  constructor() {
    super('Não foi possível consultar os produtos e seus estoques.', 502);
  }
}
