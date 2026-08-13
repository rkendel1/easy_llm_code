export interface CommitRecord {
  id: string;
  sha: string;
  parentShas: string[];
  message: string;
  author?: string;
  timestamp: string;
}

export interface FileChangeRecord {
  id: string;
  commitId: string;
  fileId: string;
  changeType: "added" | "modified" | "deleted" | "renamed" | "copied";
  oldPath?: string;
  newPath?: string;
  additions: number;
  deletions: number;
}

export interface HistoryCursor { repositoryId: string; lastIndexedCommit: string }
export interface ParsedCommit { commit: CommitRecord; changes: FileChangeRecord[] }
