-- 所有记录统一使用软删除。deleted_at 为空表示正常记录，非空表示进入回收站的时间。

ALTER TABLE feeding_records ADD COLUMN deleted_at INTEGER;
ALTER TABLE weight_records ADD COLUMN deleted_at INTEGER;
ALTER TABLE medication_records ADD COLUMN deleted_at INTEGER;
ALTER TABLE checkup_records ADD COLUMN deleted_at INTEGER;
ALTER TABLE fetal_movement_records ADD COLUMN deleted_at INTEGER;
ALTER TABLE blood_glucose_records ADD COLUMN deleted_at INTEGER;
ALTER TABLE excretion_records ADD COLUMN deleted_at INTEGER;

