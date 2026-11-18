ALTER TABLE `Notification`
    ADD COLUMN `dedupeKey` VARCHAR(191) NULL,
    ADD UNIQUE INDEX `Notification_dedupeKey_key` (`dedupeKey`);
