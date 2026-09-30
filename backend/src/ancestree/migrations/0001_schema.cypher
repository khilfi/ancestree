// People are identified by a permanent UUID, never by name.
CREATE CONSTRAINT person_id IF NOT EXISTS
FOR (p:Person) REQUIRE p.id IS UNIQUE;

// Search by name or nickname.
CREATE FULLTEXT INDEX person_names IF NOT EXISTS
FOR (p:Person) ON EACH [p.full_name, p.nickname];

// Links are edited and deleted by id.
CREATE INDEX parent_of_id IF NOT EXISTS FOR ()-[r:PARENT_OF]-() ON (r.id);
CREATE INDEX spouse_of_id IF NOT EXISTS FOR ()-[r:SPOUSE_OF]-() ON (r.id);

// Relationship kinds are configurable.
CREATE CONSTRAINT relationship_kind_key IF NOT EXISTS
FOR (k:RelationshipKind) REQUIRE k.key IS UNIQUE;
