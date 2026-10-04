// SPDX-License-Identifier: Elastic-2.0
import AVFoundation
import ExpoModulesCore
import UIKit
import VisionKit

public class PairingScannerModule: Module {
  private var session: PairingScanSession?

  public func definition() -> ModuleDefinition {
    Name("PairingScanner")

    AsyncFunction("scanAsync") { (promise: Promise) in
      guard self.session == nil else {
        promise.reject("ERR_SCANNER_BUSY", "The scanner is already open.")
        return
      }
      guard DataScannerViewController.isSupported,
            DataScannerViewController.isAvailable,
            let presenter = self.appContext?.utilities?.currentViewController() else {
        promise.reject("ERR_SCANNER_UNAVAILABLE", "Live scanning is unavailable on this device.")
        return
      }
      let session = PairingScanSession { [weak self] value in
        self?.session = nil
        promise.resolve(value)
      }
      self.session = session
      session.present(from: presenter)
    }.runOnQueue(.main)

    AsyncFunction("dismissAsync") {
      self.session?.finish(nil)
    }.runOnQueue(.main)

    OnAppEntersBackground {
      DispatchQueue.main.async { self.session?.finish(nil) }
    }

    OnDestroy {
      DispatchQueue.main.async { self.session?.finish(nil) }
    }
  }
}

private final class PairingScanSession: NSObject, DataScannerViewControllerDelegate {
  private let scanner = DataScannerViewController(
    recognizedDataTypes: [.barcode(symbologies: [.qr])],
    qualityLevel: .accurate,
    recognizesMultipleItems: false,
    isHighFrameRateTrackingEnabled: false,
    isPinchToZoomEnabled: true,
    isGuidanceEnabled: true,
    isHighlightingEnabled: true
  )
  private var navigation: UINavigationController?
  private var completion: ((String?) -> Void)?

  init(completion: @escaping (String?) -> Void) {
    self.completion = completion
    super.init()
    scanner.delegate = self
  }

  func present(from presenter: UIViewController) {
    scanner.title = "Scan pairing QR code"
    scanner.navigationItem.leftBarButtonItem = UIBarButtonItem(
      barButtonSystemItem: .cancel, target: self, action: #selector(cancel)
    )
    let navigation = UINavigationController(rootViewController: scanner)
    navigation.modalPresentationStyle = .fullScreen
    self.navigation = navigation
    presenter.present(navigation, animated: true) { [weak self] in
      guard let self, self.completion != nil else { return }
      do {
        try self.scanner.startScanning()
      } catch {
        self.finish(nil)
      }
    }
  }

  @objc private func cancel() { finish(nil) }

  func finish(_ value: String?) {
    guard let complete = completion else { return }
    completion = nil
    scanner.stopScanning()
    navigation?.dismiss(animated: true) { complete(value) }
  }

  func dataScanner(
    _ dataScanner: DataScannerViewController,
    didAdd addedItems: [RecognizedItem],
    allItems: [RecognizedItem]
  ) {
    for item in addedItems {
      if case .barcode(let barcode) = item, let value = barcode.payloadStringValue {
        finish(value)
        return
      }
    }
  }

  func dataScanner(
    _ dataScanner: DataScannerViewController,
    becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable
  ) {
    finish(nil)
  }
}
