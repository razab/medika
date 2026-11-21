// This database belonged only to the retired voice draft queue.
try {
  window.indexedDB?.deleteDatabase('medika-voice-queue');
} catch {
  // Some browser settings disable access to IndexedDB.
}
