// Malay and Javanese words for the starting kinds.
// Only where none are set yet, so words changed in Settings stay as they are.
MATCH (k:RelationshipKind {key: 'adoptive'})
WHERE k.label_ms IS NULL
SET k.label_ms = 'angkat',
  k.parent_label_ms = 'bapa atau emak angkat', k.parent_label_male_ms = 'bapa angkat',
  k.parent_label_female_ms = 'emak angkat',
  k.child_label_ms = 'anak angkat';

MATCH (k:RelationshipKind {key: 'adoptive'})
WHERE k.label_jv IS NULL
SET k.label_jv = 'angkat',
  k.parent_label_jv = 'wong tuwa angkat', k.parent_label_male_jv = 'bapak angkat',
  k.parent_label_female_jv = 'ibu angkat',
  k.child_label_jv = 'anak pupon';

// Malay says angkat for fostering too; Javanese takes asuh from Indonesian.
MATCH (k:RelationshipKind {key: 'foster'})
WHERE k.label_ms IS NULL
SET k.label_ms = 'angkat',
  k.parent_label_ms = 'bapa atau emak angkat', k.parent_label_male_ms = 'bapa angkat',
  k.parent_label_female_ms = 'emak angkat',
  k.child_label_ms = 'anak angkat';

MATCH (k:RelationshipKind {key: 'foster'})
WHERE k.label_jv IS NULL
SET k.label_jv = 'asuh',
  k.parent_label_jv = 'wong tuwa asuh', k.parent_label_male_jv = 'bapak asuh',
  k.parent_label_female_jv = 'ibu asuh',
  k.child_label_jv = 'anak asuh';
