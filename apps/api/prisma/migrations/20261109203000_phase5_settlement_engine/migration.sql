ALTER TABLE `Trip`
    ADD COLUMN `settlementRevision` INTEGER NOT NULL DEFAULT 1;

ALTER TABLE `Settlement`
    ADD COLUMN `currency` VARCHAR(191) NOT NULL DEFAULT 'INR',
    ADD COLUMN `planRevision` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `createdByUserId` VARCHAR(191) NULL,
    ADD COLUMN `finalizedAt` DATETIME(3) NULL,
    ADD INDEX `Settlement_tripId_planRevision_idx` (`tripId`, `planRevision`);

ALTER TABLE `SettlementPayment`
    ADD COLUMN `transactionReference` VARCHAR(191) NULL,
    ADD COLUMN `idempotencyKey` VARCHAR(191) NULL,
    ADD COLUMN `debtorSubmittedAt` DATETIME(3) NULL,
    ADD COLUMN `creditorConfirmedAt` DATETIME(3) NULL,
    ADD COLUMN `disputedAt` DATETIME(3) NULL,
    ADD COLUMN `disputeReason` VARCHAR(500) NULL,
    ADD COLUMN `submittedByUserId` VARCHAR(191) NULL,
    ADD COLUMN `confirmedByUserId` VARCHAR(191) NULL,
    ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    MODIFY COLUMN `status` ENUM(
        'PENDING',
        'INITIATED',
        'SUCCESSFUL',
        'VERIFIED',
        'REJECTED',
        'FAILED',
        'EXPIRED',
        'DECLINED',
        'DISPUTED',
        'REFUNDED'
    ) NOT NULL DEFAULT 'PENDING',
    ADD UNIQUE INDEX `SettlementPayment_idempotencyKey_key` (`idempotencyKey`),
    ADD INDEX `SettlementPayment_settlementId_status_idx` (`settlementId`, `status`);

CREATE TABLE `SettlementExpenseReview` (
    `id` VARCHAR(191) NOT NULL,
    `tripId` VARCHAR(191) NOT NULL,
    `expenseId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `reviewRevision` INTEGER NOT NULL DEFAULT 1,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `comment` VARCHAR(500) NULL,
    `resolvedByUserId` VARCHAR(191) NULL,
    `resolutionReason` VARCHAR(500) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `SettlementExpenseReview_expenseId_userId_reviewRevision_key` (`expenseId`, `userId`, `reviewRevision`),
    INDEX `SettlementExpenseReview_tripId_status_idx` (`tripId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SettlementPaymentEvent` (
    `id` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `actorUserId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(500) NULL,
    `details` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `SettlementPaymentEvent_idempotencyKey_key` (`idempotencyKey`),
    INDEX `SettlementPaymentEvent_paymentId_createdAt_idx` (`paymentId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SettlementLedgerEntry` (
    `id` VARCHAR(191) NOT NULL,
    `tripId` VARCHAR(191) NOT NULL,
    `settlementId` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdByUserId` VARCHAR(191) NOT NULL,
    `entryType` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL,
    `reversalOfId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `SettlementLedgerEntry_reversalOfId_key` (`reversalOfId`),
    INDEX `SettlementLedgerEntry_tripId_userId_createdAt_idx` (`tripId`, `userId`, `createdAt`),
    UNIQUE INDEX `SettlementLedgerEntry_paymentId_entryType_key` (`paymentId`, `entryType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SettlementExpenseReview`
    ADD CONSTRAINT `SettlementExpenseReview_tripId_fkey`
    FOREIGN KEY (`tripId`) REFERENCES `Trip` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `SettlementExpenseReview_expenseId_fkey`
    FOREIGN KEY (`expenseId`) REFERENCES `Expense` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `SettlementPaymentEvent`
    ADD CONSTRAINT `SettlementPaymentEvent_paymentId_fkey`
    FOREIGN KEY (`paymentId`) REFERENCES `SettlementPayment` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `SettlementLedgerEntry`
    ADD CONSTRAINT `SettlementLedgerEntry_tripId_fkey`
    FOREIGN KEY (`tripId`) REFERENCES `Trip` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `SettlementLedgerEntry_settlementId_fkey`
    FOREIGN KEY (`settlementId`) REFERENCES `Settlement` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `SettlementLedgerEntry_paymentId_fkey`
    FOREIGN KEY (`paymentId`) REFERENCES `SettlementPayment` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `SettlementLedgerEntry_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
