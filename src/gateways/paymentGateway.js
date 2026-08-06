/**
 * Contrato que qualquer gateway de pagamento precisa implementar. O domínio
 * (billing/payouts) só conhece esta interface — nunca importa a SDK da Asaas
 * ou de qualquer outro gateway diretamente. Trocar de gateway = escrever um
 * adapter novo que implemente os mesmos métodos e apontar `gatewayFactory`
 * para ele.
 *
 * @typedef {Object} CriarCobrancaInput
 * @property {number} valor
 * @property {string} dataVencimento  - AAAA-MM-DD
 * @property {string} externalReference
 * @property {string} idempotencyKey - retry deve devolver a mesma cobrança
 * @property {string} descricao
 * @property {string} customerId - identificador do pagador no provider
 * @property {'BOLETO'|'PIX'} [billingType]
 *
 * @typedef {Object} CobrancaCriada
 * @property {string} externalPaymentId
 * @property {string|null} linhaDigitavel
 * @property {string|null} codigoBarras
 * @property {string|null} urlBoleto
 * @property {string|null} urlFatura
 * @property {string|null} qrCodePix
 * @property {string|null} copiaColaPix
 * @property {string} statusGateway
 * @property {Object|null} rawJson
 *
 * @typedef {Object} TransferenciaInput
 * @property {number} valor
 * @property {Object} contaBancaria
 *
 * @typedef {Object} TransferenciaCriada
 * @property {string} externalTransferId
 * @property {string} status
 */

/**
 * @interface PaymentGateway
 * - provider: string
 * - supportsIdempotentChargeCreation: true
 * - validateConfiguration(): void
 * - ensureCustomer(input): Promise<{externalCustomerId: string}>
 * - createCharge(input: CriarCobrancaInput): Promise<CobrancaCriada>
 * - cancelCharge(externalPaymentId: string): Promise<void>
 * - transfer(input: TransferenciaInput): Promise<TransferenciaCriada>
 */
