# Vortex Orders Service

Microsserviço responsável pelo domínio de pedidos. Este primeiro esqueleto define o contrato HTTP, os DTOs e o modelo inicial; a lógica de negócio da service ainda não foi implementada.

## Endpoints

Todos usam o prefixo `/api/v1`.

- `GET /orders`: listar pedidos.
- `GET /orders/:id`: consultar um pedido.
- `GET /orders/user/:userId`: listar pedidos de um usuário.
- `POST /orders`: criar pedido com usuário e itens (`productId` e `quantity`).
- `POST /orders/:id/cancel`: cancelar pedido.
- `GET /metrics`: métricas Prometheus.
- `/doc`: documentação Swagger.

## Configuração

Configure `ORDERS_DB_URL`, `PORT` (opcional, padrão `3000`) e `OTEL_EXPORTER_OTLP_ENDPOINT`. Use `npm run prisma:generate` para gerar o Prisma Client e `npx prisma migrate deploy` para aplicar a migration em desenvolvimento.

O schema mantém snapshots de preço nos itens do pedido e não cria chaves estrangeiras para Users ou Products, que pertencem a outros serviços.
