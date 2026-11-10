-- 1 = calculated mid-refresh from the days downloaded so far (replaced when the refresh finishes)
ALTER TABLE scores ADD COLUMN partial INTEGER NOT NULL DEFAULT 0;
