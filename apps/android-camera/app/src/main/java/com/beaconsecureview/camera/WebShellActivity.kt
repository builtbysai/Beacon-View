package com.beaconsecureview.camera

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.PictureInPictureParams
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.util.Rational
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
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
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
    private val pkce by lazy { GoogleSignInPkce(this) }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == NOTIFICATION_PERMISSION_REQUEST) {
            val answer = pendingNotificationAnswer
            pendingNotificationAnswer = null
            answer?.invoke(grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED)
            return
        }
        if (requestCode != WEB_PERMISSION_REQUEST) return
        val request = pendingWebRequest ?: return
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
        applySystemBars(root)
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
        // A plain link to a file (an installer on the downloads page) is the browser's job, not the view's.
        webView.setDownloadListener { url, _, _, _, _ -> openOutside(url) }
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    when {
                        customView != null -> exitFullscreen()
                        webView.canGoBack() -> webView.goBack()
                        else -> finish()
                    }
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

    // --- Look: system bars that match the page, and fullscreen video ------------------------------------------

    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    /** Light page, dark icons; dark page, light icons: the page follows the phone's theme, so the bars do too. */
    private fun applySystemBars(root: View) {
        val dark =
            (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        val background = if (dark) 0xFF09090B.toInt() else 0xFFF9FAFB.toInt()
        window.setBackgroundDrawable(ColorDrawable(background))
        root.setBackgroundColor(background)
        @Suppress("DEPRECATION")
        run {
            window.statusBarColor = background
            window.navigationBarColor = background
        }
        WindowCompat.getInsetsController(window, root).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
    }

    private fun enterFullscreen(view: View, callback: WebChromeClient.CustomViewCallback) {
        if (customView != null) {
            callback.onCustomViewHidden()
            return
        }
        customView = view
        customViewCallback = callback
        (window.decorView as ViewGroup).addView(
            view,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
        webView.visibility = View.INVISIBLE
        WindowCompat.getInsetsController(window, view).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            hide(WindowInsetsCompat.Type.systemBars())
        }
    }

    private fun exitFullscreen() {
        val view = customView ?: return
        (window.decorView as ViewGroup).removeView(view)
        customView = null
        webView.visibility = View.VISIBLE
        WindowCompat.getInsetsController(window, webView).show(WindowInsetsCompat.Type.systemBars())
        customViewCallback?.onCustomViewHidden()
        customViewCallback = null
    }

    override fun onDestroy() {
        if (customView != null) exitFullscreen()
        fileSaver.abortAll()
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
            webView.evaluateJavascript(WebShellPolicy.exchangeScript(result.code, verifier), null)
            awaitExchange(attemptsLeft = EXCHANGE_POLLS)
        }
        if (WebShellPolicy.isAppUrl(webView.url, appOrigin)) {
            redeem()
        } else {
            pendingRedeem = redeem
            webView.loadUrl("$appOrigin/")
        }
    }

    /** Asks the page every quarter second for the answer to the sign-in request, and gives up after about 20 seconds. */
    private fun awaitExchange(attemptsLeft: Int) {
        webView.evaluateJavascript(WebShellPolicy.EXCHANGE_RESULT_SCRIPT) { value ->
            if (value == null || value == "null") {
                if (attemptsLeft > 0) {
                    webView.postDelayed({ awaitExchange(attemptsLeft - 1) }, EXCHANGE_POLL_MS)
                } else {
                    webView.loadUrl("$appOrigin/?googleSignIn=failed")
                }
                return@evaluateJavascript
            }
            val destination =
                WebShellPolicy.exchangeDestination(value)
                    ?: if (WebShellPolicy.exchangeNeedsLinking(value)) "/?googleSignIn=linkRequired" else "/?googleSignIn=failed"
            webView.loadUrl(appOrigin + destination)
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
            bridge.handle(message.data) { runOnUiThread { reply.postMessage(it) } }
        }
    }

    private fun pushCameraState() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        bridgeProxy?.postMessage(NativeBridgeProtocol.event("camera", cameraState()))
    }

    override val appVersion: String get() = BuildConfig.VERSION_NAME

    override fun cameraState(): JSONObject =
        NativeBridgeProtocol.cameraState(CredentialStore(this).read() != null, CameraRuntime.state.value, defaultDeviceName())

    override fun pushState(): JSONObject {
        val consent = NotificationConsentStore(this)
        return JSONObject().put("enabled", consent.enabled).put("stale", consent.tokenStale)
    }

    override fun enablePush(done: (Result<JSONObject>) -> Unit) {
        val proceed = {
            lifecycleScope.launch {
                done(
                    runCatching {
                        val token = firebaseMessagingToken()
                        JSONObject().put("token", token).put("installationId", installationId(this@WebShellActivity))
                    }.onFailure { Log.w("BeaconPush", "Phone alerts could not be turned on", it) },
                )
            }
            Unit
        }
        // Android 13 and newer hide every alert until the person allows notifications, so ask now, in context.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            pendingNotificationAnswer = { granted ->
                if (granted) proceed() else done(Result.failure(IllegalStateException("Notifications are not allowed")))
            }
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                NOTIFICATION_PERMISSION_REQUEST,
            )
        } else {
            proceed()
        }
    }

    private var pendingNotificationAnswer: ((Boolean) -> Unit)? = null

    private val fileSaver by lazy { FileSaver(applicationContext) }

    override fun saveFileStart(name: String, mime: String): String? = fileSaver.start(name, mime)

    override fun saveFileChunk(token: String, base64: String): Boolean = fileSaver.chunk(token, base64)

    override fun saveFileEnd(token: String): String? =
        fileSaver.end(token)?.also {
            Toast.makeText(this, "Saved to Downloads: $it", Toast.LENGTH_LONG).show()
        }

    override fun pushEnabled(subscriptionId: String) {
        NotificationConsentStore(this).enable(subscriptionId)
    }

    override fun disablePush(done: (Result<String?>) -> Unit) {
        lifecycleScope.launch { done(runCatching { stopFirebaseMessaging(this@WebShellActivity) }) }
    }

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

    // --- Picture in picture: the live video keeps playing in a small window over other apps ------------------

    private var pipReady = false

    override val pipSupported: Boolean
        get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

    override fun enterPip(): Boolean =
        runCatching {
            enterPictureInPictureMode(PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9)).build())
        }.getOrDefault(false)

    override fun setPipReady(ready: Boolean) {
        pipReady = ready
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (pipReady && pipSupported) enterPip()
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
        bridgeProxy?.postMessage(
            NativeBridgeProtocol.event("pip", JSONObject().put("active", isInPictureInPictureMode)),
        )
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
                ActivityCompat.requestPermissions(this@WebShellActivity, needed.toTypedArray(), WEB_PERMISSION_REQUEST)
            }
        }

        override fun onPermissionRequestCanceled(request: PermissionRequest) {
            if (pendingWebRequest === request) pendingWebRequest = null
        }

        override fun onShowCustomView(view: View, callback: CustomViewCallback) = enterFullscreen(view, callback)

        override fun onHideCustomView() = exitFullscreen()
    }

    private companion object {
        const val BRIDGE_NAME = "BeaconAndroid"
        const val WEB_PERMISSION_REQUEST = 4101
        const val NOTIFICATION_PERMISSION_REQUEST = 4102
        const val EXCHANGE_POLLS = 80
        const val EXCHANGE_POLL_MS = 250L
    }
}
