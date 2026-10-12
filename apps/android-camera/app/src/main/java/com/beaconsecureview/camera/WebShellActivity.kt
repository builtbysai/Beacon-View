package com.beaconsecureview.camera

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
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
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * The signed-in app is the web app (ADR 0121): this activity hosts it in a locked-down WebView, so every screen is
 * the same React code the browser shows. Only the app's own origin loads here; anything else opens outside.
 * The phone's camera stays native (the camera service and screen); the web app reaches it through [NativeBridge].
 */
class WebShellActivity : ComponentActivity(), NativeBridge.Host {
    private lateinit var webView: WebView
    private lateinit var errorPage: View
    private val appOrigin = WebShellPolicy.originOf(BuildConfig.BEACON_WEB_URL) ?: error("BEACON_WEB_URL is not a web URL")
    private var pendingWebRequest: PermissionRequest? = null
    private var bridgeProxy: JavaScriptReplyProxy? = null
    private val bridge = NativeBridge(this)
    private var pendingGoogleCode: WebShellPolicy.GoogleReturn.Code? = null
    private val pkce by lazy { GoogleSignInPkce(this) }

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
        installBridge()
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
        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            webView.loadUrl(startUrl(intent))
            handleLink(intent)
        }
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                CameraRuntime.state.collect { pushCameraState() }
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleLink(intent)
    }

    override fun onDestroy() {
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }

    // --- Links in: notifications, setup links and the Google hand-off ---------------------------------------

    private fun startUrl(intent: Intent?): String =
        intent?.dataString?.takeIf { WebShellPolicy.isAppUrl(it, appOrigin) } ?: BuildConfig.BEACON_WEB_URL

    private fun handleLink(intent: Intent) {
        val link = intent.dataString ?: return
        WebShellPolicy.parseGoogleReturn(link)?.let {
            completeGoogleSignIn(it)
            return
        }
        // A notification or a link opens the web app at the page it names, but only on the app's own origin.
        if (WebShellPolicy.isAppUrl(link, appOrigin) && link != webView.url) webView.loadUrl(link)
    }

    private fun startGoogleSignIn(addPassword: Boolean) {
        val challenge = pkce.begin()
        openOutside(WebShellPolicy.googleStartUrl(appOrigin, challenge, addPassword))
    }

    private fun completeGoogleSignIn(result: WebShellPolicy.GoogleReturn) {
        // A link this app did not ask for has no verifier to pair with and is dropped.
        val verifier = pkce.take() ?: return
        if (result !is WebShellPolicy.GoogleReturn.Code) {
            webView.loadUrl("$appOrigin/?googleSignIn=failed")
            return
        }
        val redeem = {
            webView.evaluateJavascript(WebShellPolicy.exchangeScript(result.code, verifier)) { value ->
                val destination =
                    WebShellPolicy.exchangeDestination(value)
                        ?: if (WebShellPolicy.exchangeNeedsLinking(value)) "/?googleSignIn=linkRequired" else "/?googleSignIn=failed"
                webView.loadUrl(appOrigin + destination)
            }
        }
        if (WebShellPolicy.isAppUrl(webView.url, appOrigin)) {
            redeem()
        } else {
            pendingGoogleCode = result
            pendingRedeem = redeem
            webView.loadUrl("$appOrigin/")
        }
    }

    private var pendingRedeem: (() -> Unit)? = null

    private fun openOutside(url: String) {
        val uri = Uri.parse(url)
        if (uri.scheme != "https" && uri.scheme != "http" && uri.scheme != "mailto") return
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
    }

    private fun continueInBrowser(settingsPath: String) {
        AlertDialog.Builder(this)
            .setTitle("Continue in your browser")
            .setMessage("Google doesn't allow its sign-in page inside apps. Finish connecting your Google account from Beacon in your web browser.")
            .setPositiveButton("Open in browser") { _, _ -> openOutside(appOrigin + settingsPath) }
            .setNegativeButton("Cancel", null)
            .show()
    }

    // --- The bridge ----------------------------------------------------------------------------------------

    private fun installBridge() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        WebViewCompat.addWebMessageListener(webView, BRIDGE_NAME, setOf(appOrigin)) { _, message: WebMessageCompat, sourceOrigin, isMainFrame, reply ->
            // The origin rule already limits who sees the object; these checks are the second lock.
            if (!isMainFrame || WebShellPolicy.originOf(sourceOrigin.toString()) != appOrigin) return@addWebMessageListener
            bridgeProxy = reply
            bridge.handle(message.data)?.let(reply::postMessage)
        }
    }

    private fun pushCameraState() {
        bridgeProxy?.postMessage(NativeBridgeProtocol.event("camera", cameraState()))
    }

    override val appVersion: String get() = BuildConfig.VERSION_NAME

    override fun cameraState(): JSONObject =
        NativeBridgeProtocol.cameraState(CredentialStore(this).read() != null, CameraRuntime.state.value, defaultDeviceName())

    override fun startCamera(code: String) {
        startActivity(
            Intent(this, MainActivity::class.java)
                .setAction(MainActivity.ACTION_START_CAMERA)
                .putExtra(MainActivity.EXTRA_PAIRING_CODE, code),
        )
    }

    override fun openCameraScreen() {
        startActivity(Intent(this, MainActivity::class.java).setAction(MainActivity.ACTION_OPEN_CAMERA))
    }

    override fun setPrivacy(enabled: Boolean) {
        CameraForegroundService.setPrivacyMode(this, enabled)
    }

    override fun disconnectCamera() {
        val store = CredentialStore(this)
        val credential = store.read() ?: return
        beginLocalDisconnect(store) { CameraForegroundService.stop(applicationContext) }
        lifecycleScope.launch(Dispatchers.IO) {
            // Best effort: the phone has already forgotten the pairing; the owner can also remove it from Cameras.
            runCatching { BeaconApi(BuildConfig.BEACON_API_URL).removeRegistration(credential) }
            withContext(Dispatchers.Main) { pushCameraState() }
        }
    }

    override fun openUpdate() {
        lifecycleScope.launch {
            checkForAppUpdate(this@WebShellActivity)?.let { openUpdateDownload(this@WebShellActivity, it) }
        }
    }

    // --- The error page and the permission grants ----------------------------------------------------------

    private fun buildErrorPage(): View {
        val column =
            LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setPadding(64, 64, 64, 64)
                setBackgroundColor(0xFFF9FAFB.toInt())
            }
        column.addView(
            TextView(this).apply {
                text = "Can't reach Beacon"
                textSize = 24f
                setTextColor(0xFF111827.toInt())
                gravity = Gravity.CENTER
            },
        )
        column.addView(
            TextView(this).apply {
                text = "Check your connection and try again."
                textSize = 16f
                setTextColor(0xFF4B5563.toInt())
                gravity = Gravity.CENTER
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
            when (val decision = WebShellPolicy.classify(request.url.toString(), appOrigin)) {
                WebShellPolicy.Navigation.Load -> return false
                is WebShellPolicy.Navigation.GoogleSignIn -> startGoogleSignIn(decision.addPassword)
                is WebShellPolicy.Navigation.GoogleInBrowser -> continueInBrowser(decision.settingsPath)
                is WebShellPolicy.Navigation.External -> openOutside(decision.url)
                WebShellPolicy.Navigation.Blocked -> Unit
            }
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            errorPage.visibility = View.GONE
        }

        override fun onPageFinished(view: WebView, url: String?) {
            pendingRedeem?.takeIf { WebShellPolicy.isAppUrl(url, appOrigin) }?.let {
                pendingRedeem = null
                pendingGoogleCode = null
                it()
            }
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

    private companion object {
        const val BRIDGE_NAME = "BeaconAndroid"
    }
}
