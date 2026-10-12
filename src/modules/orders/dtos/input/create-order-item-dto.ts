import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsUUID, Min } from 'class-validator';

export class CreateOrderItemDto {
  @ApiProperty({ example: 'b7e2f3a1-9876-4c2d-9f0a-abcdef123456' })
  @IsUUID('4', { message: 'O campo [productId] precisa ser um UUID válido.' })
  productId: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt({ message: 'O campo [quantity] precisa ser um número inteiro.' })
  @Min(1, { message: 'A quantidade precisa ser pelo menos 1.' })
  quantity: number;
}
