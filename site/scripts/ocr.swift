import Foundation
import Vision
import ImageIO

func output(_ value: Any) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
}

do {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    let supported = try request.supportedRecognitionLanguages()
    let languages = ["ru-RU", "en-US"].filter { supported.contains($0) }
    request.recognitionLanguages = languages
    if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--languages" {
        try output(["languages": languages, "supported": supported])
    } else {
        guard CommandLine.arguments.count == 2 else { throw NSError(domain: "Medika", code: 1, userInfo: [NSLocalizedDescriptionKey: "Укажите изображение"]) }
        let url = URL(fileURLWithPath: CommandLine.arguments[1])
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0, width <= 12000, height <= 12000, width * height <= 40000000
        else { throw NSError(domain: "Medika", code: 2, userInfo: [NSLocalizedDescriptionKey: "Изображение повреждено или превышает 40 мегапикселей"]) }
        let orientation = CGImagePropertyOrientation(rawValue: (properties[kCGImagePropertyOrientation] as? UInt32) ?? 1) ?? .up
        guard let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { throw NSError(domain: "Medika", code: 3) }
        try VNImageRequestHandler(cgImage: image, orientation: orientation).perform([request])
        let lines: [[String: Any]] = (request.results ?? []).compactMap { observation in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            let b = observation.boundingBox
            return ["text": candidate.string, "confidence": candidate.confidence, "box": [b.origin.x, b.origin.y, b.width, b.height]]
        }
        try output(["text": lines.map { $0["text"] as! String }.joined(separator: "\n"), "lines": lines, "languages": languages, "engine": "Apple Vision", "width": width, "height": height])
    }
} catch {
    FileHandle.standardError.write(Data("Распознавание не выполнено: \(error.localizedDescription)\n".utf8))
    exit(1)
}
