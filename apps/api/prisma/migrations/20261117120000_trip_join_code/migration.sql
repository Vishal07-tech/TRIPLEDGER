-- Add a shareable join code so members can enter a trip from their own phone.
-- Nullable because trips created before this migration have no code yet and
-- nulls are allowed by a unique index in MySQL.
ALTER TABLE `Trip`
ADD COLUMN `joinCode` VARCHAR(12) NULL;

CREATE UNIQUE INDEX `Trip_joinCode_key` ON `Trip`(`joinCode`);
