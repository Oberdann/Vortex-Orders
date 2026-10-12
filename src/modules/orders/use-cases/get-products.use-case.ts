import { Injectable } from '@nestjs/common';
import { ProductNotFoundException } from '../exceptions/product-not-found.exception';
import { ProductsGatewayUnavailableException } from '../exceptions/products-gateway-unavailable.exception';

export interface ProductSnapshot {
  id: string;
  price: number;
  isActive: boolean;
  stock: {
    available: number;
    inStock: boolean;
  };
}

interface ProductGatewayResponse {
  success: boolean;
  data?: ProductSnapshot;
}

@Injectable()
export class GetProductsUseCase {
  private readonly productsGatewayUrl = process.env.PRODUCTS_GATEWAY_URL;

  async execute(productIds: string[]): Promise<ProductSnapshot[]> {
    if (!this.productsGatewayUrl) {
      throw new ProductsGatewayUnavailableException();
    }

    const uniqueProductIds = [...new Set(productIds)];

    return Promise.all(
      uniqueProductIds.map((productId) => this.getProduct(productId)),
    );
  }

  private async getProduct(productId: string): Promise<ProductSnapshot> {
    let response: Response;

    try {
      response = await fetch(
        `${this.productsGatewayUrl}/products/${encodeURIComponent(productId)}`,
      );
    } catch {
      throw new ProductsGatewayUnavailableException();
    }

    if (response.status === 404) {
      throw new ProductNotFoundException(productId);
    }

    if (!response.ok) {
      throw new ProductsGatewayUnavailableException();
    }

    let body: ProductGatewayResponse;

    try {
      body = (await response.json()) as ProductGatewayResponse;
    } catch {
      throw new ProductsGatewayUnavailableException();
    }

    const product = body.data;
    const isValidProduct =
      body.success === true &&
      product !== undefined &&
      product.id === productId &&
      typeof product.price === 'number' &&
      Number.isFinite(product.price) &&
      product.price > 0 &&
      typeof product.isActive === 'boolean' &&
      Number.isSafeInteger(product.stock?.available) &&
      product.stock.available >= 0 &&
      typeof product.stock.inStock === 'boolean';

    if (!isValidProduct) {
      throw new ProductsGatewayUnavailableException();
    }

    return product;
  }
}
