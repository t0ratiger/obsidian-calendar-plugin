import type { Moment } from "moment";
import { normalizePath, TFile } from "obsidian";
import {
  DailyNotesFolderMissingError,
  getAllDailyNotes as getLegacyDailyNotes,
  getDailyNoteSettings,
  getDateFromFile,
  getDateUID,
} from "obsidian-daily-notes-interface";

/** Parse hierarchical daily note formats relative to the configured folder. */
export function getDailyNoteDate(file: TFile | null): Moment | null {
  if (!(file instanceof TFile) || file.extension !== "md") {
    return null;
  }

  const { format, folder } = getDailyNoteSettings();
  if (!format.includes("/")) {
    return getDateFromFile(file, "day");
  }

  const normalizedFolder = normalizePath(folder || "").replace(/^\/+|\/+$/g, "");
  const prefix = normalizedFolder ? `${normalizedFolder}/` : "";
  if (!file.path.startsWith(prefix)) {
    return null;
  }

  const relativePath = file.path.slice(prefix.length, -3);
  const date = window.moment(relativePath, format, true);
  return date.isValid() ? date : null;
}

export function getAllDailyNotes(): Record<string, TFile> {
  const { format, folder } = getDailyNoteSettings();
  if (!format.includes("/")) {
    return getLegacyDailyNotes();
  }

  const { vault } = window.app;
  if (!vault.getAbstractFileByPath(normalizePath(folder || ""))) {
    throw new DailyNotesFolderMissingError("Failed to find daily notes folder");
  }

  const notes: Record<string, TFile> = {};
  for (const file of vault.getMarkdownFiles()) {
    const date = getDailyNoteDate(file);
    if (date) {
      notes[getDateUID(date, "day")] = file;
    }
  }
  return notes;
}
