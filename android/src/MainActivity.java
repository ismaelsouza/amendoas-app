package br.com.casadasamendoas.vendedor.piloto;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.IOException;
import java.util.Collections;

public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private WebView web;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return true;
            }

            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if ("GET".equals(request.getMethod()) && url.startsWith(ORIGIN + "/")) {
                    String path = url.substring(ORIGIN.length() + 1);
                    String mime;
                    switch (path) {
                        case "index.html": mime = "text/html"; break;
                        case "mobile.css": mime = "text/css"; break;
                        case "js/mobile-ui.js": mime = "text/javascript"; break;
                        default: return unavailable();
                    }
                    try {
                        return new WebResourceResponse(mime, "UTF-8", getAssets().open(path));
                    } catch (IOException ignored) {
                        return unavailable();
                    }
                }
                return unavailable();
            }
        });
        setContentView(web);
        web.loadUrl(ORIGIN + "/index.html");
    }

    private static WebResourceResponse unavailable() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(), null);
    }

    @Override public void onResume() {
        super.onResume();
        if (web != null) web.evaluateJavascript("window.dispatchEvent(new Event('amendoas:retomado'))", null);
    }

    @Override public void onDestroy() {
        if (web != null) {
            setContentView(new android.widget.FrameLayout(this));
            web.destroy();
        }
        super.onDestroy();
    }
}
