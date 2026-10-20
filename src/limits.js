export const LIMITS = {
  scriptBytes: 512 * 1024,
  scriptScenes: 120,
  scriptLines: 8000,
  scriptLineChars: 2000,
  scenesPerProduction: 200,
  shotsPerScene: 200,
  itemsPerDay: 200,
  daysPerProduction: 60,
  charactersPerProduction: 300,
  locationsPerProduction: 300,
  imageBytes: 5 * 1024 * 1024,
  imageEdge: 4096,
  imagePixels: 8_000_000,
  jsonBytes: 1_500_000,
  name: 160,
  short: 200,
  logline: 500,
  notes: 20_000,
  scriptField: 524288,
  description: 10_000,
  durationMax: 1439,
  previewHours: 24,
  bodyDefault: 1_000_000,
  bodyScript: 1_200_000,
  bodyImage: 5_500_000,
  bodyJson: 1_700_000,
}

export const SHOT_SIZES = [
  "Wide",
  "Medium wide",
  "Medium",
  "Medium close-up",
  "Close-up",
  "Extreme close-up",
  "Insert",
  "Establishing",
]

export const CAMERA_ANGLES = [
  "Eye level",
  "Low",
  "High",
  "Overhead",
  "Dutch",
  "Bird's eye",
  "Worm's eye",
]

export const CAMERA_MOVES = [
  "Static",
  "Pan",
  "Tilt",
  "Dolly",
  "Truck",
  "Handheld",
  "Zoom",
  "Crane",
  "Steadicam",
  "Whip pan",
]

export const PLANNING_STATUSES = [
  { value: "idea", label: "Idea" },
  { value: "planned", label: "Planned" },
  { value: "ready", label: "Ready" },
  { value: "cut", label: "Cut" },
]

export const INT_EXT = [
  { value: "INT", label: "INT" },
  { value: "EXT", label: "EXT" },
  { value: "INT_EXT", label: "INT/EXT" },
  { value: "EST", label: "EST" },
  { value: "OTHER", label: "Other" },
]

export const STORY_TIMES = ["DAY", "NIGHT", "DAWN", "DUSK", "MORNING", "EVENING", "CONTINUOUS", "LATER"]

export const ITEM_KINDS = [
  { value: "scene_work", label: "Scene work" },
  { value: "break", label: "Break" },
  { value: "setup_move", label: "Setup or company move" },
  { value: "other", label: "Other activity" },
]
