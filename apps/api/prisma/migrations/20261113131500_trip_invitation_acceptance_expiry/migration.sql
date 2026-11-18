ALTER TABLE `TripInvitation`
    ADD COLUMN `expiresAt` DATETIME(3) NULL,
    ADD COLUMN `acceptedAt` DATETIME(3) NULL,
    ADD COLUMN `acceptedByUserId` VARCHAR(191) NULL;

UPDATE `TripInvitation`
SET `expiresAt` = DATE_ADD(`createdAt`, INTERVAL 7 DAY)
WHERE `expiresAt` IS NULL;

ALTER TABLE `TripInvitation`
    MODIFY COLUMN `expiresAt` DATETIME(3) NOT NULL,
    ADD INDEX `TripInvitation_email_status_expiresAt_idx` (`email`, `status`, `expiresAt`),
    ADD INDEX `TripInvitation_tripId_status_expiresAt_idx` (`tripId`, `status`, `expiresAt`),
    ADD INDEX `TripInvitation_acceptedByUserId_idx` (`acceptedByUserId`),
    ADD CONSTRAINT `TripInvitation_acceptedByUserId_fkey`
        FOREIGN KEY (`acceptedByUserId`) REFERENCES `User` (`id`)
        ON DELETE SET NULL ON UPDATE CASCADE;
