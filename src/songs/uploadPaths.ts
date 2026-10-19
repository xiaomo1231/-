/**
 * Paths of uploaded files (自己上传的谱). They look like library paths so every
 * page and route that opens a score by path works with them, but they live in
 * SCORES_DATA/uploads/, never in the (read-only) library.
 */
export const UPLOAD_PREFIX = '~uploads/'

const UPLOAD_PATH = /^~uploads\/([0-9a-f]{12})\/([0-9a-f]{12})\.([a-z0-9]{2,8})$/

export function isUploadPath(p: string): boolean {
  return p.startsWith(UPLOAD_PREFIX)
}

export function uploadPath(songId: string, fileId: string, ext: string): string {
  return `${UPLOAD_PREFIX}${songId}/${fileId}.${ext}`
}

/** The song, file and extension of an upload path, or null when it is not a well-formed one. */
export function parseUploadPath(p: string): { songId: string; fileId: string; ext: string } | null {
  const m = UPLOAD_PATH.exec(p)
  return m ? { songId: m[1]!, fileId: m[2]!, ext: m[3]! } : null
}
