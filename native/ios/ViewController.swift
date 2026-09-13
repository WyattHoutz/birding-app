import UIKit
import WebKit
import UniformTypeIdentifiers
import Capacitor

class ViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(FullReportPlugin())
    }
}

@objc(FullReportPlugin)
public final class FullReportPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FullReportPlugin"
    public let jsName = "FullReport"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "copyReportImage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareReport", returnType: CAPPluginReturnPromise)
    ]
    private let maxClipboardImageHeight: CGFloat = 30_000

    private func reportURL(_ requestedName: String?) -> URL {
        var name = requestedName ?? "Bird-Chaser-report.pdf"
        name = name.replacingOccurrences(
            of: "[^A-Za-z0-9._-]+",
            with: "-",
            options: .regularExpression
        )
        if !name.lowercased().hasSuffix(".pdf") {
            name += ".pdf"
        }
        return FileManager.default.temporaryDirectory.appendingPathComponent(name)
    }

    private func createReportPDF(
        fileName: String?,
        completion: @escaping (Result<(Data, URL), Error>) -> Void
    ) {
        guard let webView else {
            completion(.failure(NSError(
                domain: "BirdChaser.FullReport",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "The report web view is unavailable."]
            )))
            return
        }

        DispatchQueue.main.async {
            let contentSize = webView.scrollView.contentSize
            guard contentSize.width > 0, contentSize.height > 0 else {
                completion(.failure(NSError(
                    domain: "BirdChaser.FullReport",
                    code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "The report has no rendered content."]
                )))
                return
            }

            let configuration = WKPDFConfiguration()
            configuration.rect = CGRect(
                x: 0,
                y: 0,
                width: contentSize.width,
                height: contentSize.height
            )
            webView.createPDF(configuration: configuration) { result in
                do {
                    let data = try result.get()
                    let url = self.reportURL(fileName)
                    try data.write(to: url, options: .atomic)
                    completion(.success((data, url)))
                } catch {
                    completion(.failure(error))
                }
            }
        }
    }

    @objc public func copyReportImage(_ call: CAPPluginCall) {
        guard let webView else {
            call.reject("The report web view is unavailable.")
            return
        }
        DispatchQueue.main.async {
            let contentSize = webView.scrollView.contentSize
            guard contentSize.width > 0, contentSize.height > 0 else {
                call.reject("The report has no rendered content.")
                return
            }
            let targetScale = min(UIScreen.main.scale, 3)
            let targetWidth = min(contentSize.width * targetScale, 1_290)
            let targetHeight = contentSize.height * targetWidth / contentSize.width
            guard targetHeight <= self.maxClipboardImageHeight else {
                call.reject(
                    "This report is too tall for one clipboard image. Use Share report PDF instead."
                )
                return
            }

            let configuration = WKSnapshotConfiguration()
            configuration.rect = CGRect(
                x: 0,
                y: 0,
                width: contentSize.width,
                height: contentSize.height
            )
            configuration.snapshotWidth = NSNumber(value: Double(targetWidth))
            webView.takeSnapshot(with: configuration) { image, error in
                guard let image else {
                    call.reject(
                        "Unable to capture the full report image: "
                            + (error?.localizedDescription ?? "unknown error")
                    )
                    return
                }
                guard let data = image.jpegData(compressionQuality: 0.92) else {
                    call.reject("Unable to encode the full report image.")
                    return
                }
                UIPasteboard.general.setData(data, forPasteboardType: UTType.jpeg.identifier)
                call.resolve([
                    "bytes": data.count,
                    "width": Int(image.size.width),
                    "height": Int(image.size.height)
                ])
            }
        }
    }

    @objc public func shareReport(_ call: CAPPluginCall) {
        createReportPDF(fileName: call.getString("fileName")) { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let (data, url)):
                    guard let presenter = self.bridge?.viewController else {
                        call.reject("Unable to open the PDF share sheet.")
                        return
                    }
                    let sheet = UIActivityViewController(
                        activityItems: [url],
                        applicationActivities: nil
                    )
                    if let popover = sheet.popoverPresentationController {
                        popover.sourceView = presenter.view
                        popover.sourceRect = CGRect(
                            x: presenter.view.bounds.midX,
                            y: presenter.view.bounds.maxY,
                            width: 1,
                            height: 1
                        )
                    }
                    sheet.completionWithItemsHandler = { _, completed, _, error in
                        if let error {
                            call.reject("Unable to share the full report PDF: \(error.localizedDescription)")
                            return
                        }
                        call.resolve([
                            "bytes": data.count,
                            "fileName": url.lastPathComponent,
                            "completed": completed
                        ])
                    }
                    presenter.present(sheet, animated: true)
                case .failure(let error):
                    call.reject("Unable to create the full report PDF: \(error.localizedDescription)")
                }
            }
        }
    }
}
