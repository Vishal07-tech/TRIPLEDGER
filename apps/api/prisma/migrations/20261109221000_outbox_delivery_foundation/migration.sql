ALTER TABLE `OutboxEvent`
    ADD COLUMN `eventKey` VARCHAR(191) NULL,
    ADD COLUMN `attempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `lockedAt` DATETIME(3) NULL,
    ADD COLUMN `lastError` VARCHAR(1000) NULL,
    ADD UNIQUE INDEX `OutboxEvent_eventKey_key`(`eventKey`),
    ADD INDEX `OutboxEvent_tripId_createdAt_id_idx`(`tripId`, `createdAt`, `id`),
    ADD INDEX `OutboxEvent_processedAt_nextAttemptAt_lockedAt_idx`(`processedAt`, `nextAttemptAt`, `lockedAt`);
