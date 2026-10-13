import moment from "moment";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import {
  createDailyNote,
  DailyNotesFolderMissingError,
  getDailyNote,
  getDateUID,
} from "obsidian-daily-notes-interface";

import { getDateUIDFromFile } from "src/ui/utils";
import { getAllDailyNotes, getDailyNoteDate } from "./dailyNotePaths";

jest.mock("obsidian", () => ({
  TFile: class {},
  Notice: class {},
  normalizePath: (path: string) => path.replace(/\\/g, "/")
    .replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "") || "/",
  Vault: {
    recurseChildren: (folder: { children: TFile[] }, cb: (file: TFile) => void) => {
      folder.children.forEach(cb);
    },
  },
}));

function note(path: string): TFile {
  const name = path.split("/").pop();
  return Object.assign(new TFile(), {
    path,
    name,
    basename: name.slice(0, name.lastIndexOf(".")),
    extension: name.split(".").pop(),
  });
}

describe("daily note paths", () => {
  let options: { format: string; folder: string; template: string };
  let files: TFile[];
  let folders: Set<string>;
  let create: jest.Mock;

  beforeEach(() => {
    options = { format: "YYYY/MM/DD", folder: "Daily", template: "" };
    files = [];
    folders = new Set(["/", "Daily"]);
    create = jest.fn(async (path: string, _contents: string) => {
      const file = note(path);
      files.push(file);
      return file;
    });
    window.moment = moment;
    window.app = {
      plugins: { getPlugin: () => null },
      internalPlugins: {
        getPluginById: () => ({ instance: { options } }),
      },
      vault: {
        getMarkdownFiles: () => files.filter((file) => file.extension === "md"),
        getAbstractFileByPath: (path: string) => folders.has(path)
          ? { children: files.filter((file) => file.path.startsWith(`${path}/`)) }
          : null,
        createFolder: jest.fn(async (path: string) => { folders.add(path); }),
        create,
        cachedRead: async () => "{{date:YYYY-MM-DD}} / {{title}}",
      },
      metadataCache: { getFirstLinkpathDest: () => note("Templates/Daily.md") },
      foldManager: { load: () => null, save: jest.fn() },
    } as unknown as App;
  });

  it("uses the year and month from folders, including for past notes", () => {
    expect(getDailyNoteDate(note("Daily/2020/02/29.md"))?.format("YYYY-MM-DD"))
      .toBe("2020-02-29");
    expect(getDailyNoteDate(note("Daily/2025/12/14.md"))?.format("YYYY-MM-DD"))
      .toBe("2025-12-14");
  });

  it("indexes the same day number in different months and years separately", () => {
    files = [note("Daily/2025/10/14.md"), note("Daily/2026/09/14.md"),
      note("Daily/2026/10/14.md")];
    const notes = getAllDailyNotes();
    expect(Object.keys(notes)).toHaveLength(3);
    expect(getDailyNote(moment("2025-10-14"), notes)).toBe(files[0]);
    expect(getDailyNote(moment("2026-09-14"), notes)).toBe(files[1]);
    expect(getDailyNote(moment("2026-10-14"), notes)).toBe(files[2]);
  });

  it.each([
    "Daily/2025/02/29.md", "Daily/2026/13/14.md", "Daily/2026/10/32.md",
    "Daily/14.md", "Daily/extra/2026/10/14.md", "DailyOther/2026/10/14.md",
    "Other/2026/10/14.md", "Daily/2026/10/14.png",
  ])("rejects invalid or unrelated paths: %s", (path) => {
    expect(getDailyNoteDate(note(path))).toBeNull();
  });

  it("ignores folders and an absent active file", () => {
    expect(getDailyNoteDate({ path: "Daily/2026/10" } as TFile)).toBeNull();
    expect(getDateUIDFromFile(null)).toBeNull();
  });

  it.each(["", "/", "Journal/Daily", "Journal/Daily/"])(
    "supports the configured folder %s", (folder) => {
      options.folder = folder;
      const prefix = folder.replace(/^\/+|\/+$/g, "");
      const file = note(`${prefix ? `${prefix}/` : ""}2026/10/14.md`);
      folders.add(prefix || "/");
      files = [file];
      expect(getDailyNoteDate(file)?.format("YYYY-MM-DD")).toBe("2026-10-14");
      expect(getDailyNote(moment("2026-10-14"), getAllDailyNotes())).toBe(file);
    }
  );

  it("supports literal directory names and full dates in the filename", () => {
    options.format = "[Archive]/YYYY/MM/YYYY-MM-DD";
    expect(getDailyNoteDate(note("Daily/Archive/2026/10/2026-10-14.md"))
      ?.format("YYYY-MM-DD")).toBe("2026-10-14");
  });

  it("selects the correct calendar day for a hierarchical note", () => {
    expect(getDateUIDFromFile(note("Daily/2020/02/29.md")))
      .toBe(getDateUID(moment("2020-02-29"), "day"));
  });

  it("preserves flat date format discovery", () => {
    options.format = "YYYY-MM-DD";
    files = [note("Daily/2026-10-14.md")];
    expect(getDailyNoteDate(files[0])?.format("YYYY-MM-DD")).toBe("2026-10-14");
    expect(getDailyNote(moment("2026-10-14"), getAllDailyNotes())).toBe(files[0]);
  });

  it("reports a missing configured folder", () => {
    folders.delete("Daily");
    expect(() => getAllDailyNotes()).toThrow(DailyNotesFolderMissingError);
  });

  it("creates nested notes through the existing API and discovers them", async () => {
    options.template = "Templates/Daily";
    const date = moment("2020-02-29");
    const file = await createDailyNote(date);
    expect(window.app.vault.createFolder).toHaveBeenCalledWith("Daily/2020/02");
    expect(create).toHaveBeenCalledWith("Daily/2020/02/29.md", "2020-02-29 / 2020/02/29");
    expect(getDailyNote(date, getAllDailyNotes())).toBe(file);
  });

  it("refreshes the index after a note moves to another month or is deleted", () => {
    files = [note("Daily/2026/10/14.md")];
    files[0] = note("Daily/2026/11/14.md");
    expect(getDailyNote(moment("2026-10-14"), getAllDailyNotes())).toBeNull();
    expect(getDailyNote(moment("2026-11-14"), getAllDailyNotes())).toBe(files[0]);
    files = [];
    expect(getAllDailyNotes()).toEqual({});
  });
});
