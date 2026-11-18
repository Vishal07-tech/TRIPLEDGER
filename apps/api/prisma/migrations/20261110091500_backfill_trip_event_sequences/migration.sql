START TRANSACTION;

UPDATE `OutboxEvent` AS event
JOIN (
    SELECT
        `id`,
        `tripId`,
        ROW_NUMBER() OVER (PARTITION BY `tripId` ORDER BY `createdAt`, `id`) AS `row_num`
    FROM `OutboxEvent`
    WHERE `tripId` IS NOT NULL
      AND `tripSequence` IS NULL
) AS sequenced ON sequenced.`id` = event.`id`
JOIN `Trip` AS trip ON trip.`id` = event.`tripId`
SET event.`tripSequence` = trip.`eventSequence` + sequenced.`row_num`;

UPDATE `Trip` AS trip
SET trip.`eventSequence` = GREATEST(
    trip.`eventSequence`,
    COALESCE((
        SELECT MAX(event.`tripSequence`)
        FROM `OutboxEvent` AS event
        WHERE event.`tripId` = trip.`id`
    ), 0)
);

COMMIT;
