CREATE TABLE productions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  timezone TEXT NOT NULL CHECK (length(timezone) BETWEEN 1 AND 80),
  logline TEXT NOT NULL DEFAULT '' CHECK (length(logline) <= 500),
  notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 20000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  scene_order_revision INTEGER NOT NULL DEFAULT 1 CHECK (scene_order_revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE script_versions (
  id TEXT PRIMARY KEY,
  production_id TEXT NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  original_text TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('paste', 'upload')),
  original_filename TEXT NOT NULL DEFAULT '',
  committed_preamble TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE import_previews (
  id TEXT PRIMARY KEY,
  production_id TEXT REFERENCES productions(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('existing', 'new', 'json')),
  new_name TEXT NOT NULL DEFAULT '',
  new_timezone TEXT NOT NULL DEFAULT '',
  new_logline TEXT NOT NULL DEFAULT '',
  source_kind TEXT NOT NULL CHECK (source_kind IN ('paste', 'upload', 'json')),
  original_filename TEXT NOT NULL DEFAULT '',
  original_text TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  production_id TEXT NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 20000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  UNIQUE (production_id, name)
);

CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  production_id TEXT NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 20000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  UNIQUE (production_id, name)
);

CREATE TABLE scenes (
  id TEXT PRIMARY KEY,
  production_id TEXT NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  script_version_id TEXT REFERENCES script_versions(id) ON DELETE SET NULL,
  display_number TEXT NOT NULL DEFAULT '' CHECK (length(display_number) <= 12),
  heading TEXT NOT NULL CHECK (length(trim(heading)) BETWEEN 1 AND 240),
  int_ext TEXT NOT NULL CHECK (int_ext IN ('INT', 'EXT', 'INT_EXT', 'EST', 'OTHER')),
  location_id TEXT REFERENCES locations(id) ON DELETE RESTRICT,
  story_time_of_day TEXT NOT NULL DEFAULT '' CHECK (length(story_time_of_day) <= 80),
  script_text TEXT NOT NULL DEFAULT '' CHECK (length(script_text) <= 524288),
  synopsis TEXT NOT NULL DEFAULT '' CHECK (length(synopsis) <= 5000),
  production_notes TEXT NOT NULL DEFAULT '' CHECK (length(production_notes) <= 20000),
  shooting_duration_override_minutes INTEGER CHECK (
    shooting_duration_override_minutes IS NULL
    OR (shooting_duration_override_minutes >= 0 AND shooting_duration_override_minutes <= 1439)
  ),
  sort_order INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  shot_order_revision INTEGER NOT NULL DEFAULT 1 CHECK (shot_order_revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE scene_characters (
  scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
  PRIMARY KEY (scene_id, character_id)
);

CREATE TABLE storyboard_images (
  id TEXT PRIMARY KEY,
  production_id TEXT NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL CHECK (content_type = 'image/png'),
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  original_filename TEXT NOT NULL DEFAULT '' CHECK (length(original_filename) <= 240),
  created_at TEXT NOT NULL
);

CREATE TABLE shots (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  display_label TEXT NOT NULL DEFAULT '' CHECK (length(display_label) <= 40),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 10000),
  shot_size TEXT NOT NULL DEFAULT '' CHECK (length(shot_size) <= 40),
  camera_angle TEXT NOT NULL DEFAULT '' CHECK (length(camera_angle) <= 40),
  camera_movement TEXT NOT NULL DEFAULT '' CHECK (length(camera_movement) <= 40),
  lens_note TEXT NOT NULL DEFAULT '' CHECK (length(lens_note) <= 120),
  shooting_duration_minutes INTEGER CHECK (
    shooting_duration_minutes IS NULL
    OR (shooting_duration_minutes >= 0 AND shooting_duration_minutes <= 1439)
  ),
  equipment_notes TEXT NOT NULL DEFAULT '' CHECK (length(equipment_notes) <= 2000),
  storyboard_image_id TEXT REFERENCES storyboard_images(id) ON DELETE RESTRICT,
  image_alt TEXT NOT NULL DEFAULT '' CHECK (length(image_alt) <= 300),
  planning_status TEXT NOT NULL DEFAULT 'planned' CHECK (planning_status IN ('idea', 'planned', 'ready', 'cut')),
  sort_order INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE shoot_days (
  id TEXT PRIMARY KEY,
  production_id TEXT NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  local_date TEXT NOT NULL CHECK (length(local_date) = 10),
  local_start_time TEXT NOT NULL CHECK (length(local_start_time) = 5),
  label TEXT NOT NULL DEFAULT '' CHECK (length(label) <= 120),
  max_planned_duration_minutes INTEGER CHECK (
    max_planned_duration_minutes IS NULL
    OR (max_planned_duration_minutes >= 1 AND max_planned_duration_minutes <= 1439)
  ),
  notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 20000),
  schedule_order_revision INTEGER NOT NULL DEFAULT 1 CHECK (schedule_order_revision >= 1),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE schedule_items (
  id TEXT PRIMARY KEY,
  shoot_day_id TEXT NOT NULL REFERENCES shoot_days(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('scene_work', 'break', 'setup_move', 'other')),
  scene_id TEXT REFERENCES scenes(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '' CHECK (length(label) <= 200),
  duration_minutes INTEGER CHECK (
    duration_minutes IS NULL
    OR (duration_minutes >= 0 AND duration_minutes <= 1439)
  ),
  sort_order INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CHECK (
    (kind = 'scene_work' AND scene_id IS NOT NULL AND duration_minutes IS NULL)
    OR (kind <> 'scene_work' AND scene_id IS NULL AND duration_minutes IS NOT NULL)
  )
);

CREATE UNIQUE INDEX schedule_items_one_scene ON schedule_items(scene_id) WHERE scene_id IS NOT NULL;
CREATE INDEX scenes_production_idx ON scenes(production_id, sort_order);
CREATE INDEX shots_scene_idx ON shots(scene_id, sort_order);
CREATE INDEX schedule_day_idx ON schedule_items(shoot_day_id, sort_order);
CREATE INDEX images_production_idx ON storyboard_images(production_id);
CREATE INDEX script_versions_production_idx ON script_versions(production_id);
CREATE INDEX scene_characters_character_idx ON scene_characters(character_id);

CREATE TRIGGER scenes_location_same_production_insert
BEFORE INSERT ON scenes
FOR EACH ROW
WHEN NEW.location_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT production_id FROM locations WHERE id = NEW.location_id) IS NOT NEW.production_id
    THEN RAISE(ABORT, 'cross-production location')
  END;
END;

CREATE TRIGGER scenes_location_same_production_update
BEFORE UPDATE OF location_id, production_id ON scenes
FOR EACH ROW
WHEN NEW.location_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT production_id FROM locations WHERE id = NEW.location_id) IS NOT NEW.production_id
    THEN RAISE(ABORT, 'cross-production location')
  END;
END;

CREATE TRIGGER scene_characters_same_production
BEFORE INSERT ON scene_characters
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN (SELECT production_id FROM characters WHERE id = NEW.character_id)
      IS NOT (SELECT production_id FROM scenes WHERE id = NEW.scene_id)
    THEN RAISE(ABORT, 'cross-production character')
  END;
END;

CREATE TRIGGER shots_image_same_production_insert
BEFORE INSERT ON shots
FOR EACH ROW
WHEN NEW.storyboard_image_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT production_id FROM storyboard_images WHERE id = NEW.storyboard_image_id)
      IS NOT (SELECT production_id FROM scenes WHERE id = NEW.scene_id)
    THEN RAISE(ABORT, 'cross-production image')
  END;
END;

CREATE TRIGGER shots_image_same_production_update
BEFORE UPDATE OF storyboard_image_id, scene_id ON shots
FOR EACH ROW
WHEN NEW.storyboard_image_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT production_id FROM storyboard_images WHERE id = NEW.storyboard_image_id)
      IS NOT (SELECT production_id FROM scenes WHERE id = NEW.scene_id)
    THEN RAISE(ABORT, 'cross-production image')
  END;
END;

CREATE TRIGGER schedule_scene_same_production
BEFORE INSERT ON schedule_items
FOR EACH ROW
WHEN NEW.scene_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT production_id FROM scenes WHERE id = NEW.scene_id)
      IS NOT (SELECT production_id FROM shoot_days WHERE id = NEW.shoot_day_id)
    THEN RAISE(ABORT, 'cross-production scene')
  END;
END;

CREATE TRIGGER schedule_scene_same_production_update
BEFORE UPDATE OF scene_id, shoot_day_id ON schedule_items
FOR EACH ROW
WHEN NEW.scene_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT production_id FROM scenes WHERE id = NEW.scene_id)
      IS NOT (SELECT production_id FROM shoot_days WHERE id = NEW.shoot_day_id)
    THEN RAISE(ABORT, 'cross-production scene')
  END;
END;
