ALTER TABLE `SettlementPayment`
    ADD COLUMN `paymentMethod` ENUM('UPI', 'CASH', 'BANK_TRANSFER', 'OTHER') NULL,
    ADD COLUMN `paymentDateTime` DATETIME(3) NULL,
    ADD COLUMN `paymentNotes` VARCHAR(500) NULL;
