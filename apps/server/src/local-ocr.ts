import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { type ParsedStatement, parseStatementOcrPages } from "./statement-parser";

const execFileAsync = promisify(execFile);

export async function parseScannedPdfWithLocalOcr(pdfPath: string): Promise<ParsedStatement> {
  if (process.platform !== "darwin") {
    throw new Error("Local scanned-PDF OCR currently requires macOS.");
  }
  const scriptPath = join(process.cwd(), "scripts", "ocr-statement.swift");
  if (!existsSync(scriptPath)) {
    throw new Error("The local OCR helper is missing from this installation.");
  }
  const { stdout } = await execFileAsync("/usr/bin/swift", [scriptPath, pdfPath], {
    encoding: "utf8",
    maxBuffer: 25 * 1024 * 1024,
    timeout: 5 * 60 * 1000,
  });
  const pages = JSON.parse(stdout) as Array<{ page: number; lines: string[] }>;
  if (!Array.isArray(pages)) {
    throw new Error("The local OCR helper returned an invalid result.");
  }
  return parseStatementOcrPages(pages);
}
