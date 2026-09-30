// Built in: the only kind that counts as blood lineage. It cannot be removed.
MERGE (k:RelationshipKind {key: 'biological'})
ON CREATE SET k.label = 'Biological', k.builtin = true, k.blood = true, k.active = true,
  k.in_layout = true, k.sort_order = 1,
  k.parent_label = 'parent', k.parent_label_male = 'father', k.parent_label_female = 'mother',
  k.child_label = 'child', k.child_label_male = 'son', k.child_label_female = 'daughter';

// Starting defaults. Rename, hide or add more in Settings.
MERGE (k:RelationshipKind {key: 'adoptive'})
ON CREATE SET k.label = 'Adoptive', k.builtin = false, k.blood = false, k.active = true,
  k.in_layout = true, k.sort_order = 2,
  k.parent_label = 'adoptive parent', k.parent_label_male = 'adoptive father',
  k.parent_label_female = 'adoptive mother',
  k.child_label = 'adopted child', k.child_label_male = 'adopted son',
  k.child_label_female = 'adopted daughter';

MERGE (k:RelationshipKind {key: 'foster'})
ON CREATE SET k.label = 'Foster', k.builtin = false, k.blood = false, k.active = true,
  k.in_layout = true, k.sort_order = 3,
  k.parent_label = 'foster parent', k.parent_label_male = 'foster father',
  k.parent_label_female = 'foster mother',
  k.child_label = 'foster child', k.child_label_male = 'foster son',
  k.child_label_female = 'foster daughter';
