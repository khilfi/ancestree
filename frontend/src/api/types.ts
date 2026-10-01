import type { components } from "./schema";

type Schemas = components["schemas"];

export type Graph = Schemas["Graph"];
export type GraphPerson = Schemas["GraphPerson"];
export type GraphLink = Schemas["GraphLink"];
export type GraphLayout = Schemas["GraphLayout"];
export type LayoutUnit = Schemas["LayoutUnit"];
export type Seat = Schemas["Seat"];
export type TreeSettings = Schemas["TreeSettings"];
export type Position = Schemas["Position"];
export type Health = Schemas["Health"];

export type Gender = Schemas["Gender"];
export type PartialDate = Schemas["PartialDate"];
export type Place = Schemas["Place"];
export type PersonDetail = Schemas["PersonDetail"];
export type JournalEntry = Schemas["JournalEntry"]; // who changed someone
export type MergePreview = Schemas["MergePreview"]; // two people made one
export type DateView = Schemas["DateView"];
export type PersonSummary = Schemas["PersonSummary"];
export type PersonInput = Schemas["PersonInput"];
export type PersonSaved = Schemas["PersonSaved"];
export type Relative = Schemas["Relative"];
export type ChildGroup = Schemas["ChildGroup"];
export type NewRelative = Schemas["NewRelative"];
export type FillIn = Schemas["FillIn"];
export type RelativeAdded = Schemas["RelativeAdded"];
export type RelationshipCreate = Schemas["RelationshipCreate"];
export type RelationshipUpdate = Schemas["RelationshipUpdate"];
export type RelationshipResult = Schemas["RelationshipResult"];
export type Notice = Schemas["Notice"];
export type Suggestion = Schemas["Suggestion"];
export type Relation = RelationshipCreate["a_is"];
export type SpouseStatus = Schemas["SpouseStatus"];
export type KindView = Schemas["KindView"];
export type KindInput = Schemas["KindInput"];
export type KindUpdate = Schemas["KindUpdate"];
export type TrashEntry = Schemas["TrashEntry"];
export type RestoreResult = Schemas["RestoreResult"];
export type DateReading = Schemas["DateReading"];
export type Crop = Schemas["Crop"];
export type KinshipAnswer = Schemas["KinshipAnswer"];
export type KinRelation = Schemas["KinRelation"];
export type KinStatement = Schemas["KinStatement"];
export type KinExplanation = Schemas["KinExplanation"];
export type KinPerson = Schemas["KinPerson"];
export type KinWord = Schemas["KinWord"];
export type KindWords = Schemas["KindWords"];
export type KinshipSettings = Schemas["KinshipSettings"];
export type KinshipLanguage = KinshipSettings["language"];
export type KinshipDictionary = Schemas["KinshipDictionary"];
export type DictionarySection = Schemas["DictionarySection"];
export type DictionaryRow = Schemas["DictionaryRow"];
export type DictionaryWord = Schemas["DictionaryWord"];
export type Biography = Schemas["Biography"];
export type BiographyUpdate = Schemas["BiographyUpdate"];
export type PictureAdded = Schemas["PictureAdded"];
export type ExportFormat = Schemas["ExportFormat"];
export type ExportRequest = Schemas["ExportRequest"];
export type ExportFile = Schemas["ExportFile"];
export type Backup = Schemas["Backup"];
export type BackupList = Schemas["BackupList"];
export type FamilyFacts = Schemas["FamilyFacts"];
export type MeSettings = Schemas["MeSettings"];
export type PersonPatch = Schemas["PersonPatch"];
export type FactPerson = Schemas["FactPerson"];
export type NameCount = Schemas["NameCount"];
export type BackupRestored = Schemas["BackupRestored"];
export type ImportPreview = Schemas["ImportPreview"];
export type ImportChange = Schemas["ImportChange"];
export type ImportQuestion = Schemas["ImportQuestion"];
export type ImportOption = Schemas["ImportOption"];
export type ImportLeftOut = Schemas["ImportLeftOut"];
export type ImportSecondLook = Schemas["ImportSecondLook"];
export type ImportDifference = Schemas["ImportDifference"];
export type ImportPerson = Schemas["ImportPerson"];
export type ImportDone = Schemas["ImportDone"];
export type ImportSummary = Schemas["ImportSummary"];
export type ImportTakenBack = Schemas["ImportTakenBack"];
export type CopyPreview = Schemas["CopyPreview"];
export type CopyReturned = Schemas["CopyReturned"];
export type FamilyMap = Schemas["FamilyMap"];
export type MapPerson = Schemas["MapPerson"];
export type Located = Schemas["Located"];
export type Pin = Schemas["Pin"];
export type MapPins = Schemas["MapPins"];
export type HistoryStep = Schemas["HistoryStep"];
export type HistoryView = Schemas["HistoryView"];
export type HistoryMove = Schemas["HistoryMove"];
export type Positions = Schemas["Positions"];
export type LinkView = Schemas["LinkView"];
export type ChildrenOrder = Schemas["ChildrenOrder"];

/** Anyone drawn with a photo circle: people in the tree, relatives, search results. */
export type Avatarable = {
  id: string;
  full_name: string;
  photo_version: number | null;
  placeholder: boolean;
};

// The family folder
export type FamilyFolderStatus = Schemas["FamilyFolderStatus"];
export type FolderMember = Schemas["FolderMember"];
export type FolderAsking = Schemas["FolderAsking"];
export type SharedFolder = Schemas["SharedFolder"];
export type StartFamily = Schemas["StartFamily"];
export type JoinFamily = Schemas["JoinFamily"];
export type Recover = Schemas["Recover"];
export type Admit = Schemas["Admit"];
// Changes sent back through the family folder
export type FolderAnswer = Schemas["FolderAnswer"];
export type FolderChanges = Schemas["FolderChanges"];
export type BringIn = Schemas["BringIn"];
