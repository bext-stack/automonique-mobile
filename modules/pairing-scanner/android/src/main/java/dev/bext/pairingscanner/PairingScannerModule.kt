// SPDX-License-Identifier: Elastic-2.0
package dev.bext.pairingscanner

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import com.google.zxing.client.android.Intents
import com.journeyapps.barcodescanner.CaptureActivity
import com.journeyapps.barcodescanner.ScanOptions
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

class PairingScannerActivity : CaptureActivity() {
  companion object {
    private var current = WeakReference<PairingScannerActivity>(null)
    fun dismiss() { current.get()?.finish() }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    // Pairing proofs must not appear in screenshots or the recent-apps preview.
    window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    super.onCreate(savedInstanceState)
    current = WeakReference(this)
  }

  override fun onDestroy() {
    if (current.get() === this) current.clear()
    super.onDestroy()
  }
}

private class PairingScanContract : AppContextActivityResultContract<String, String?> {
  override fun createIntent(context: Context, input: String): Intent =
    ScanOptions()
      .setCaptureActivity(PairingScannerActivity::class.java)
      .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
      .setPrompt("Point at the Monique pairing QR code. Scanning is automatic. Back to cancel.")
      .setBeepEnabled(false)
      .setBarcodeImageEnabled(false)
      .createScanIntent(context)

  override fun parseResult(input: String, resultCode: Int, intent: Intent?): String? =
    if (resultCode == Activity.RESULT_OK) intent?.getStringExtra(Intents.Scan.RESULT) else null
}

class PairingScannerModule : Module() {
  private lateinit var scanner: AppContextActivityResultLauncher<String, String?>
  private var scanning = false

  override fun definition() = ModuleDefinition {
    Name("PairingScanner")

    RegisterActivityContracts {
      // Never retain a pairing proof after the launching activity is destroyed.
      scanner = registerForActivityResult(PairingScanContract()) { _, _ -> }
    }

    AsyncFunction("scanAsync") Coroutine { ->
      check(!scanning) { "pairing_scanner_busy" }
      scanning = true
      try {
        scanner.launch("")
      } finally {
        scanning = false
      }
    }

    AsyncFunction("dismissAsync") {
      PairingScannerActivity.dismiss()
    }.runOnQueue(Queues.MAIN)
  }
}
