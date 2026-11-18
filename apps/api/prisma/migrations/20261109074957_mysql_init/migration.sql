-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `fullName` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `role` ENUM('OWNER', 'ADMIN', 'MEMBER', 'VIEWER') NOT NULL DEFAULT 'MEMBER',
    `themePreference` VARCHAR(191) NULL DEFAULT 'system',
    `avatarUrl` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserPreference` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `locale` VARCHAR(191) NULL DEFAULT 'en',
    `timezone` VARCHAR(191) NULL DEFAULT 'UTC',
    `currency` VARCHAR(191) NULL DEFAULT 'INR',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `UserPreference_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Trip` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `baseCurrency` VARCHAR(191) NOT NULL DEFAULT 'INR',
    `status` ENUM('ACTIVE', 'CLOSING', 'EXPENSE_REVIEW', 'SETTLEMENT_PLANNED', 'PAYMENTS_PENDING', 'PARTIALLY_SETTLED', 'FULLY_SETTLED', 'TRIP_CLOSED') NOT NULL DEFAULT 'ACTIVE',
    `cashManagerUserId` VARCHAR(191) NULL,
    `createdByUserId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TripSetting` (
    `id` VARCHAR(191) NOT NULL,
    `tripId` VARCHAR(191) NOT NULL,
    `allowMemberExpenseEdit` BOOLEAN NOT NULL DEFAULT true,
    `requireLocationConfirmation` BOOLEAN NOT NULL DEFAULT true,
    `allowPublicJoin` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TripSetting_tripId_key`(`tripId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TripMember` (
    `id` VARCHAR(191) NOT NULL,
    `tripId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `role` ENUM('OWNER', 'ADMIN', 'MEMBER', 'VIEWER') NOT NULL DEFAULT 'MEMBER',
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `budgetLimit` DECIMAL(18, 2) NULL,

    UNIQUE INDEX `TripMember_tripId_userId_key`(`tripId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TripInvitation` (
    `id` VARCHAR(191) NOT NULL,
    `tripId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `invitedBy` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MemberBudget` (
    `id` VARCHAR(191) NOT NULL,
    `tripId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `plannedBudget` DECIMAL(18, 2) NOT NULL,
    `remainingBudget` DECIMAL(18, 2) NOT NULL,
    `utilizationPct` DECIMAL(5, 2) NULL,
    `overspending` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `warningLevel` VARCHAR(191) NOT NULL DEFAULT 'normal',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MemberBudget_tripId_userId_key`(`tripId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Expense` (
    `id` VARCHAR(191) NOT NULL,
    `tripId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL,
    `convertedAmount` DECIMAL(18, 2) NULL,
    `exchangeRate` DECIMAL(18, 8) NULL,
    `category` VARCHAR(191) NOT NULL,
    `expenseType` ENUM('PERSONAL', 'GROUP') NOT NULL,
    `splitMethod` ENUM('EQUAL', 'EXACT', 'PERCENTAGE', 'WEIGHTED') NOT NULL,
    `paymentMethod` ENUM('UPI', 'CASH') NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `createdByUserId` VARCHAR(191) NOT NULL,
    `updatedByUserId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExpensePayer` (
    `id` VARCHAR(191) NOT NULL,
    `expenseId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL,
    `paymentStatus` ENUM('PENDING', 'INITIATED', 'VERIFIED', 'REJECTED', 'FAILED', 'DISPUTED') NOT NULL DEFAULT 'PENDING',
    `paidAt` DATETIME(3) NULL,

    UNIQUE INDEX `ExpensePayer_expenseId_userId_key`(`expenseId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExpenseAllocation` (
    `id` VARCHAR(191) NOT NULL,
    `expenseId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `allocatedAmount` DECIMAL(18, 2) NOT NULL,
    `percentage` DECIMAL(5, 2) NULL,
    `weight` DECIMAL(18, 2) NULL,
    `isManual` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `ExpenseAllocation_expenseId_userId_key`(`expenseId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExpenseLocation` (
    `id` VARCHAR(191) NOT NULL,
    `expenseId` VARCHAR(191) NOT NULL,
    `latitude` DECIMAL(10, 7) NULL,
    `longitude` DECIMAL(10, 7) NULL,
    `placeName` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `providerPlaceId` VARCHAR(191) NULL,
    `confirmationStatus` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExpenseReceipt` (
    `id` VARCHAR(191) NOT NULL,
    `expenseId` VARCHAR(191) NOT NULL,
    `fileUrl` VARCHAR(191) NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Settlement` (
    `id` VARCHAR(191) NOT NULL,
    `tripId` VARCHAR(191) NOT NULL,
    `debtorUserId` VARCHAR(191) NOT NULL,
    `creditorUserId` VARCHAR(191) NOT NULL,
    `totalAmount` DECIMAL(18, 2) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'planned',
    `settlementType` VARCHAR(191) NOT NULL DEFAULT 'transfer',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SettlementPayment` (
    `id` VARCHAR(191) NOT NULL,
    `settlementId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NULL,
    `providerTransactionId` VARCHAR(191) NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'INR',
    `status` ENUM('PENDING', 'INITIATED', 'VERIFIED', 'REJECTED', 'FAILED', 'DISPUTED') NOT NULL DEFAULT 'PENDING',
    `initiatedAt` DATETIME(3) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `acknowledgementStatus` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `disputes` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FinancialEntry` (
    `id` VARCHAR(191) NOT NULL,
    `expenseId` VARCHAR(191) NULL,
    `tripId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `entryType` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL,
    `balanceAfter` DECIMAL(18, 2) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExchangeRate` (
    `id` VARCHAR(191) NOT NULL,
    `fromCurrency` VARCHAR(191) NOT NULL,
    `toCurrency` VARCHAR(191) NOT NULL,
    `rate` DECIMAL(18, 8) NOT NULL,
    `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ExchangeRate_fromCurrency_toCurrency_capturedAt_key`(`fromCurrency`, `toCurrency`, `capturedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` VARCHAR(191) NOT NULL,
    `tripId` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NULL,
    `type` ENUM('MEMBER_JOINED', 'EXPENSE_CREATED', 'EXPENSE_UPDATED', 'LOCATION_CONFIRMATION_REQUESTED', 'BUDGET_APPROACHING', 'BUDGET_EXCEEDED', 'SETTLEMENT_GENERATED', 'SETTLEMENT_ACCEPTED', 'SETTLEMENT_DISPUTED', 'PAYMENT_INITIATED', 'PAYMENT_CONFIRMED', 'TRIP_CLOSED') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `message` VARCHAR(191) NOT NULL,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `tripId` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `details` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IdempotencyKey` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `resource` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `IdempotencyKey_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OutboxEvent` (
    `id` VARCHAR(191) NOT NULL,
    `tripId` VARCHAR(191) NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `processedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TripSetting` ADD CONSTRAINT `TripSetting_tripId_fkey` FOREIGN KEY (`tripId`) REFERENCES `Trip`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TripMember` ADD CONSTRAINT `TripMember_tripId_fkey` FOREIGN KEY (`tripId`) REFERENCES `Trip`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TripMember` ADD CONSTRAINT `TripMember_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TripInvitation` ADD CONSTRAINT `TripInvitation_tripId_fkey` FOREIGN KEY (`tripId`) REFERENCES `Trip`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MemberBudget` ADD CONSTRAINT `MemberBudget_tripId_fkey` FOREIGN KEY (`tripId`) REFERENCES `Trip`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_tripId_fkey` FOREIGN KEY (`tripId`) REFERENCES `Trip`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExpensePayer` ADD CONSTRAINT `ExpensePayer_expenseId_fkey` FOREIGN KEY (`expenseId`) REFERENCES `Expense`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExpenseAllocation` ADD CONSTRAINT `ExpenseAllocation_expenseId_fkey` FOREIGN KEY (`expenseId`) REFERENCES `Expense`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExpenseLocation` ADD CONSTRAINT `ExpenseLocation_expenseId_fkey` FOREIGN KEY (`expenseId`) REFERENCES `Expense`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExpenseReceipt` ADD CONSTRAINT `ExpenseReceipt_expenseId_fkey` FOREIGN KEY (`expenseId`) REFERENCES `Expense`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Settlement` ADD CONSTRAINT `Settlement_tripId_fkey` FOREIGN KEY (`tripId`) REFERENCES `Trip`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SettlementPayment` ADD CONSTRAINT `SettlementPayment_settlementId_fkey` FOREIGN KEY (`settlementId`) REFERENCES `Settlement`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FinancialEntry` ADD CONSTRAINT `FinancialEntry_expenseId_fkey` FOREIGN KEY (`expenseId`) REFERENCES `Expense`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_tripId_fkey` FOREIGN KEY (`tripId`) REFERENCES `Trip`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_tripId_fkey` FOREIGN KEY (`tripId`) REFERENCES `Trip`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OutboxEvent` ADD CONSTRAINT `OutboxEvent_tripId_fkey` FOREIGN KEY (`tripId`) REFERENCES `Trip`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
