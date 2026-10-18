export const RABBITMQ_EVENTS_EXCHANGE = 'vortex.events';
export const STOCK_RESERVATION_REQUESTED_EVENT = 'stock.reservation.requested';
export const STOCK_RESERVATION_CONFIRMED_EVENT = 'stock.reservation.confirmed';
export const STOCK_RESERVATION_REJECTED_EVENT = 'stock.reservation.rejected';
export const PAYMENT_CREATION_REQUESTED_EVENT = 'payment.creation.requested';
export const PAYMENT_READY_EVENT = 'payment.ready';
export const LEGACY_PAYMENT_CREATION_SUCCEEDED_EVENT =
  'payment.creation.succeeded';
export const PAYMENT_STATUS_CHANGED_EVENT = 'payment.status.changed';
export const ORDERS_STOCK_RESERVATION_RESULTS_QUEUE =
  'orders.stock-reservation-results';
export const ORDERS_STOCK_RESERVATION_CONFIRMED_RETRY_QUEUE =
  'orders.stock-reservation-confirmed.retry';
export const ORDERS_STOCK_RESERVATION_REJECTED_RETRY_QUEUE =
  'orders.stock-reservation-rejected.retry';
export const ORDERS_STOCK_RESERVATION_RESULTS_DLQ =
  'orders.stock-reservation-results.dlq';
export const ORDERS_STOCK_RESERVATION_RESULTS_FAILED_ROUTE =
  'orders.stock-reservation-results.failed';
export const ORDERS_PAYMENT_RESULTS_QUEUE = 'orders.payment-results';
export const ORDERS_PAYMENT_RESULTS_RETRY_QUEUE =
  'orders.payment-results.retry';
export const ORDERS_PAYMENT_STATUS_RESULTS_RETRY_QUEUE =
  'orders.payment-status-results.retry';
export const ORDERS_PAYMENT_RESULTS_DLQ = 'orders.payment-results.dlq';
export const ORDERS_PAYMENT_RESULTS_FAILED_ROUTE =
  'orders.payment-results.failed';
export const MAX_PROCESSING_RETRIES = 5;
export const RETRY_DELAY_MS = 5000;
