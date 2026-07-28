import AppKit
import Foundation
import PDFKit
import Vision

struct OcrPage: Codable {
  let page: Int
  let lines: [String]
}

guard CommandLine.arguments.count == 2 else {
  fputs("Usage: ocr-statement.swift <statement.pdf>\n", stderr)
  exit(2)
}

let fileURL = URL(fileURLWithPath: CommandLine.arguments[1])
guard let document = PDFDocument(url: fileURL) else {
  fputs("The PDF could not be opened for OCR.\n", stderr)
  exit(3)
}
guard document.pageCount <= 200 else {
  fputs("The PDF exceeds the 200-page OCR safety limit.\n", stderr)
  exit(4)
}

var pages: [OcrPage] = []
for pageIndex in 0..<document.pageCount {
  guard let page = document.page(at: pageIndex) else { continue }
  let bounds = page.bounds(for: .mediaBox)
  let scale: CGFloat = 2.0
  let width = max(1, Int(bounds.width * scale))
  let height = max(1, Int(bounds.height * scale))
  guard
    let context = CGContext(
      data: nil,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: 0,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )
  else { continue }

  context.setFillColor(NSColor.white.cgColor)
  context.fill(CGRect(x: 0, y: 0, width: width, height: height))
  context.saveGState()
  context.scaleBy(x: scale, y: scale)
  page.draw(with: .mediaBox, to: context)
  context.restoreGState()
  guard let image = context.makeImage() else { continue }

  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true
  request.recognitionLanguages = ["en-IN", "en-US"]
  let handler = VNImageRequestHandler(cgImage: image, options: [:])
  try handler.perform([request])

  let observations = (request.results ?? []).sorted {
    let verticalDifference = abs($0.boundingBox.midY - $1.boundingBox.midY)
    if verticalDifference > 0.015 {
      return $0.boundingBox.midY > $1.boundingBox.midY
    }
    return $0.boundingBox.minX < $1.boundingBox.minX
  }
  let lines = observations.compactMap { $0.topCandidates(1).first?.string }
  pages.append(OcrPage(page: pageIndex + 1, lines: lines))
}

let encoder = JSONEncoder()
let output = try encoder.encode(pages)
FileHandle.standardOutput.write(output)
