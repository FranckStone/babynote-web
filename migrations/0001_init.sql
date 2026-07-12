-- 宝宝笔记数据表,与 iOS Core Data / Android Room 模型一一对应。
-- 时间统一存 epoch 毫秒,按天分组在客户端本地时区完成。

CREATE TABLE feeding_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  formula_started_at INTEGER,
  feeding_type TEXT NOT NULL DEFAULT 'formula',
  amount_ml REAL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_feeding_started_at ON feeding_records (started_at DESC);

CREATE TABLE weight_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recorded_at INTEGER NOT NULL,
  weight_kg REAL NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_weight_recorded_at ON weight_records (recorded_at DESC);

CREATE TABLE medication_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recorded_at INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  dosage TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_medication_recorded_at ON medication_records (recorded_at DESC);

CREATE TABLE checkup_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recorded_at INTEGER NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  attachment_path TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_checkup_recorded_at ON checkup_records (recorded_at DESC);

CREATE TABLE fetal_movement_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recorded_at INTEGER NOT NULL,
  duration_minutes INTEGER,
  movement_count INTEGER,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_fetal_movement_recorded_at ON fetal_movement_records (recorded_at DESC);

CREATE TABLE blood_glucose_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recorded_at INTEGER NOT NULL,
  moment TEXT NOT NULL DEFAULT 'beforeBreakfast',
  value_mmol REAL NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_blood_glucose_recorded_at ON blood_glucose_records (recorded_at DESC);

CREATE TABLE excretion_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recorded_at INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'poop',
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_excretion_recorded_at ON excretion_records (recorded_at DESC);
