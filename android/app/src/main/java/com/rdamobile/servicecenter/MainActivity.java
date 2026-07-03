package com.rdamobile.servicecenter;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends Activity {

    private WebView webView;
    private ProgressBar progressBar;
    private TextView statusText;
    private SharedPreferences prefs;

    // Default server settings
    private static final String DEFAULT_SERVER_IP   = "192.168.1.100";
    private static final int    DEFAULT_SERVER_PORT  = 3000;
    private static final String PREF_SERVER_IP       = "server_ip";
    private static final String PREF_SERVER_PORT     = "server_port";
    private static final String LOCAL_HTML_PATH      = "file:///android_asset/index.html";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Fullscreen
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        setContentView(R.layout.activity_main);

        prefs      = getSharedPreferences("RDASettings", MODE_PRIVATE);
        webView    = findViewById(R.id.webView);
        progressBar= findViewById(R.id.progressBar);
        statusText = findViewById(R.id.statusText);

        setupWebView();
        loadApp();
    }

    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(false);

        // Enable WebView debugging in debug builds
        WebView.setWebContentsDebuggingEnabled(true);

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setPositiveButton("OK", (d, w) -> result.confirm())
                    .setOnCancelListener(d -> result.cancel())
                    .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setPositiveButton("OK", (d, w) -> result.confirm())
                    .setNegativeButton("Cancel", (d, w) -> result.cancel())
                    .setOnCancelListener(d -> result.cancel())
                    .show();
                return true;
            }

            @Override
            public void onProgressChanged(WebView view, int progress) {
                if (progress < 100) {
                    progressBar.setVisibility(View.VISIBLE);
                    progressBar.setProgress(progress);
                } else {
                    progressBar.setVisibility(View.GONE);
                }
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage msg) {
                android.util.Log.d("RDA", msg.message());
                return true;
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        WebResourceError error) {
                // If server URL fails, fall back to local asset
                if (request.isForMainFrame()) {
                    showStatus("Server not reachable — loading offline mode...");
                    webView.loadUrl(LOCAL_HTML_PATH);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progressBar.setVisibility(View.GONE);
                if (url.startsWith("http")) {
                    showStatus("✅ Connected to server");
                } else {
                    showStatus("📱 Offline mode");
                }
                // Inject server URL into the app so it knows where to save
                String serverUrl = getServerUrl();
                view.evaluateJavascript(
                    "if(typeof window._SERVER_URL !== 'undefined') { " +
                    "  window._SERVER_URL = '" + serverUrl + "'; " +
                    "} ", null);
            }
        });
    }

    private void loadApp() {
        // Try server first if on WiFi, else load local
        if (isOnWifi()) {
            showStatus("Checking server connection...");
            new Thread(() -> {
                String serverUrl = getServerUrl();
                boolean serverReachable = checkServer(serverUrl);
                runOnUiThread(() -> {
                    if (serverReachable) {
                        showStatus("Connecting to server...");
                        webView.loadUrl(serverUrl);
                    } else {
                        showStatus("Server not found — loading offline...");
                        webView.loadUrl(LOCAL_HTML_PATH);
                    }
                });
            }).start();
        } else {
            showStatus("No WiFi — offline mode");
            webView.loadUrl(LOCAL_HTML_PATH);
        }
    }

    private boolean checkServer(String serverUrl) {
        try {
            URL url = new URL(serverUrl + "/api/status");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(2000);
            conn.setReadTimeout(2000);
            int code = conn.getResponseCode();
            conn.disconnect();
            return code == 200;
        } catch (Exception e) {
            return false;
        }
    }

    private boolean isOnWifi() {
        ConnectivityManager cm =
            (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return false;
        NetworkInfo wifi = cm.getNetworkInfo(ConnectivityManager.TYPE_WIFI);
        return wifi != null && wifi.isConnected();
    }

    private String getServerUrl() {
        String ip   = prefs.getString(PREF_SERVER_IP, DEFAULT_SERVER_IP);
        int    port = prefs.getInt(PREF_SERVER_PORT, DEFAULT_SERVER_PORT);
        return "http://" + ip + ":" + port;
    }

    private void showStatus(String msg) {
        if (statusText != null) {
            statusText.setText(msg);
            statusText.setVisibility(View.VISIBLE);
            statusText.postDelayed(() -> {
                if (statusText != null) statusText.setVisibility(View.GONE);
            }, 3000);
        }
    }

    // ── Menu ──────────────────────────────────────────────────
    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        menu.add(0, 1, 0, "⚙️ Server Settings");
        menu.add(0, 2, 1, "🔄 Reconnect to Server");
        menu.add(0, 3, 2, "📱 Offline Mode");
        menu.add(0, 4, 3, "↩️ Reload");
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        switch (item.getItemId()) {
            case 1: showServerSettings(); return true;
            case 2: loadApp();            return true;
            case 3: webView.loadUrl(LOCAL_HTML_PATH); return true;
            case 4: webView.reload();     return true;
        }
        return super.onOptionsItemSelected(item);
    }

    private void showServerSettings() {
        String currentIp   = prefs.getString(PREF_SERVER_IP, DEFAULT_SERVER_IP);
        int    currentPort = prefs.getInt(PREF_SERVER_PORT, DEFAULT_SERVER_PORT);

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(40, 20, 40, 20);

        TextView ipLabel = new TextView(this);
        ipLabel.setText("Server IP Address (your laptop's WiFi IP):");
        layout.addView(ipLabel);

        EditText ipInput = new EditText(this);
        ipInput.setText(currentIp);
        ipInput.setHint("e.g. 192.168.1.105");
        layout.addView(ipInput);

        TextView portLabel = new TextView(this);
        portLabel.setText("Port (default 3000):");
        layout.addView(portLabel);

        EditText portInput = new EditText(this);
        portInput.setText(String.valueOf(currentPort));
        portInput.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
        layout.addView(portInput);

        TextView hint = new TextView(this);
        hint.setText("\nℹ️ Find your laptop IP in the server console window.\nLook for: Network (other devices): http://192.168.x.x:3000");
        hint.setTextSize(12);
        layout.addView(hint);

        new AlertDialog.Builder(this)
            .setTitle("Server Settings")
            .setView(layout)
            .setPositiveButton("Save & Connect", (dialog, which) -> {
                String newIp   = ipInput.getText().toString().trim();
                int    newPort = Integer.parseInt(portInput.getText().toString().trim());
                prefs.edit()
                    .putString(PREF_SERVER_IP, newIp)
                    .putInt(PREF_SERVER_PORT, newPort)
                    .apply();
                Toast.makeText(this, "Saved! Connecting...", Toast.LENGTH_SHORT).show();
                loadApp();
            })
            .setNegativeButton("Cancel", null)
            .show();
    }

    // ── Back button ───────────────────────────────────────────
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onPause() {
        super.onPause();
        webView.onPause();
    }
}
