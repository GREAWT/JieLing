export {
  isFileSystemAccessSupported, isNotFoundError, errorMessage,
  openSandboxRoot, openLocalRoot, ensureQuarantineDir, resolveHandle,
  removeByPath, readTextFile, writeTextFile,
} from "./adapter";
export { createScanner, type Scanner } from "./scan";
export {
  quarantineEntries, listQuarantine, restoreEntries, purgeExpired, emptyQuarantine, deleteQuarantined,
} from "./quarantine";
export { SANDBOX_LABEL, SANDBOX_MARKER, generateSandbox, clearSandbox, sandboxReady } from "./sandbox";
export {
  OPS_MANUAL_NAME, FOLDER_DICTIONARY_NAME, JOURNAL_NAMES,
  appendOpsManual, syncFolderDictionary, readJournal,
  itemsFromEntries, itemsFromRecords, journalError,
  type JournalOperation, type OpsEvent, type OpsItem,
} from "./journal";