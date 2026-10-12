package com.beaconsecureview.camera

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.ComponentActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * The signed-in app is the web app (ADR 0121): this activity hosts it in a locked-down WebView, so every screen is
 * the same React code the browser shows. Only the app's own origin loads here; anything else opens outside.
 */
class WebShellActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private lateinit var errorPage: View
    private val appOrigin = WebShellPolicy.originOf(BuildConfig.BEACON_WEB_URL) ?: error("BEACON_WEB_URL is not a web URL")
    private var pendingWebRequest: PermissionRequest? = null

    private val androidPermissions =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            val request = pendingWebRequest ?: return@registerForActivityResult
            pendingWebRequest = null
            answer(request)
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        errorPage = buildErrorPage()
        val root = FrameLayout(this)
        root.addView(webView, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(errorPage, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        errorPage.visibility = View.GONE
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            mediaPlaybackRequiresUserGesture = false
            setSupportMultipleWindows(false)
            userAgentString = "$userAgentString BeaconApp/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, false)
        }
        webView.webViewClient = AppClient()
        webView.webChromeClient = AppChromeClient()
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (webView.canGoBack()) webView.goBack() else finish()
                }
            },
        )
        if (savedInstanceState != null) webView.restoreState(savedInstanceState) else webView.loadUrl(startUrl(intent))
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // A notification or a link opens the web app at the page it names, but only on the app's own origin.
        intent.dataString?.takeIf { WebShellPolicy.isAppUrl(it, appOrigin) }?.let(webView::loadUrl)
    }

    override fun onDestroy() {
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }

    private fun startUrl(intent: Intent?): String =
        intent?.dataString?.takeIf { WebShellPolicy.isAppUrl(it, appOrigin) } ?: BuildConfig.BEACON_WEB_URL

    private fun buildErrorPage(): View {
        val column =
            LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = android.view.Gravity.CENTER
                setPadding(64, 64, 64, 64)
                setBackgroundColor(0xFFF9FAFB.toInt())
            }
        column.addView(
            TextView(this).apply {
                text = "Can't reach Beacon"
                textSize = 24f
                setTextColor(0xFF111827.toInt())
                gravity = android.view.Gravity.CENTER
            },
        )
        column.addView(
            TextView(this).apply {
                text = "Check your connection and try again."
                textSize = 16f
                setTextColor(0xFF4B5563.toInt())
                gravity = android.view.Gravity.CENTER
                setPadding(0, 24, 0, 48)
            },
        )
        column.addView(
            Button(this).apply {
                text = "Try again"
                setOnClickListener {
                    errorPage.visibility = View.GONE
                    webView.reload()
                }
            },
        )
        return column
    }

    private fun openOutside(url: String) {
        val uri = Uri.parse(url)
        if (uri.scheme != "https" && uri.scheme != "http" && uri.scheme != "mailto") return
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
    }

    private fun answer(request: PermissionRequest) {
        val granted =
            WebShellPolicy.resourcesToGrant(
                requested = request.resources,
                requestOrigin = request.origin.toString(),
                appOrigin = appOrigin,
                cameraAllowed = held(Manifest.permission.CAMERA),
                microphoneAllowed = held(Manifest.permission.RECORD_AUDIO),
            )
        if (granted.isEmpty()) request.deny() else request.grant(granted.toTypedArray())
    }

    private fun held(permission: String) =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private inner class AppClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url.toString()
            if (WebShellPolicy.isAppUrl(url, appOrigin)) return false
            openOutside(url)
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            errorPage.visibility = View.GONE
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) errorPage.visibility = View.VISIBLE
        }
    }

    private inner class AppChromeClient : WebChromeClient() {
        override fun onPermissionRequest(request: PermissionRequest) {
            val needed = WebShellPolicy.androidPermissionsFor(request.resources).filterNot(::held)
            if (WebShellPolicy.originOf(request.origin.toString()) != appOrigin) {
                request.deny()
            } else if (needed.isEmpty()) {
                answer(request)
            } else {
                pendingWebRequest?.deny()
                pendingWebRequest = request
                androidPermissions.launch(needed.toTypedArray())
            }
        }

        override fun onPermissionRequestCanceled(request: PermissionRequest) {
            if (pendingWebRequest === request) pendingWebRequest = null
        }
    }
}
