CREATE TABLE `SettlementRefund` (
    `id` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `createdByUserId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `SettlementRefund_idempotencyKey_key` (`idempotencyKey`),
    INDEX `SettlementRefund_paymentId_createdAt_idx` (`paymentId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SettlementLedgerEntry`
    ADD COLUMN `refundId` VARCHAR(191) NULL,
    ADD INDEX `SettlementLedgerEntry_refundId_idx` (`refundId`);

ALTER TABLE `SettlementRefund`
    ADD CONSTRAINT `SettlementRefund_paymentId_fkey`
    FOREIGN KEY (`paymentId`) REFERENCES `SettlementPayment` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `SettlementLedgerEntry`
    ADD CONSTRAINT `SettlementLedgerEntry_refundId_fkey`
    FOREIGN KEY (`refundId`) REFERENCES `SettlementRefund` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
