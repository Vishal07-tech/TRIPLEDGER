ALTER TABLE `Trip`
    ADD COLUMN `eventSequence` BIGINT NOT NULL DEFAULT 0;

ALTER TABLE `OutboxEvent`
    ADD COLUMN `tripSequence` BIGINT NULL,
    ADD UNIQUE INDEX `OutboxEvent_tripId_tripSequence_key`(`tripId`, `tripSequence`);

ALTER TABLE `Notification`
    MODIFY COLUMN `type` ENUM(
        'MEMBER_JOINED',
        'EXPENSE_CREATED',
        'EXPENSE_UPDATED',
        'LOCATION_CONFIRMATION_REQUESTED',
        'BUDGET_APPROACHING',
        'BUDGET_EXCEEDED',
        'SETTLEMENT_GENERATED',
        'SETTLEMENT_ACCEPTED',
        'SETTLEMENT_DISPUTED',
        'PAYMENT_INITIATED',
        'PAYMENT_CONFIRMED',
        'PAYMENT_DISPUTE_RESOLVED',
        'PAYMENT_REFUNDED',
        'TRIP_CLOSED'
    ) NOT NULL;

CREATE INDEX `Notification_tripId_userId_createdAt_id_idx`
    ON `Notification`(`tripId`, `userId`, `createdAt`, `id`);

CREATE INDEX `Notification_userId_isRead_tripId_idx`
    ON `Notification`(`userId`, `isRead`, `tripId`);
