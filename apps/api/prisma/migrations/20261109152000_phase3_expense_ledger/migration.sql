-- AlterTable
ALTER TABLE `expense` ADD COLUMN `correctedFromExpenseId` VARCHAR(191) NULL,
    ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE `expensepayer` ADD COLUMN `isCashManagerDisbursement` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `financialentry` ADD COLUMN `createdByUserId` VARCHAR(191) NULL,
    ADD COLUMN `reversalOfId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `memberbudget` MODIFY `utilizationPct` DECIMAL(22, 2) NULL;

-- CreateIndex
CREATE INDEX `Expense_tripId_status_date_idx` ON `Expense`(`tripId`, `status`, `date`);

-- CreateIndex
CREATE INDEX `Expense_correctedFromExpenseId_idx` ON `Expense`(`correctedFromExpenseId`);

-- CreateIndex
CREATE UNIQUE INDEX `FinancialEntry_reversalOfId_key` ON `FinancialEntry`(`reversalOfId`);

-- CreateIndex
CREATE INDEX `FinancialEntry_tripId_userId_createdAt_idx` ON `FinancialEntry`(`tripId`, `userId`, `createdAt`);

-- CreateIndex
CREATE INDEX `FinancialEntry_expenseId_entryType_idx` ON `FinancialEntry`(`expenseId`, `entryType`);

-- AddForeignKey
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_correctedFromExpenseId_fkey` FOREIGN KEY (`correctedFromExpenseId`) REFERENCES `Expense`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FinancialEntry` ADD CONSTRAINT `FinancialEntry_tripId_fkey` FOREIGN KEY (`tripId`) REFERENCES `Trip`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FinancialEntry` ADD CONSTRAINT `FinancialEntry_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FinancialEntry` ADD CONSTRAINT `FinancialEntry_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FinancialEntry` ADD CONSTRAINT `FinancialEntry_reversalOfId_fkey` FOREIGN KEY (`reversalOfId`) REFERENCES `FinancialEntry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
