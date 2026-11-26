package br.com.casadasamendoas.vendedor.homologacao;

import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.IOException;
import java.util.Collections;
import java.util.regex.Pattern;

public final class MainActivity extends Activity {
    private static final String HOST = "homologacao-app.com.br";
    private static final String LOCAL = "/apk-amendoas-local/";
    private static final String API = "/api-amendoas-adm/api/v1";
    private static final Pattern PEDIDO = Pattern.compile(API + "/pedidos/campo/[1-9][0-9]{0,9}/(entregas|correcoes)");
    private WebView web;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptCookie(false);
        web.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return true;
            }

            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!"https".equals(url.getScheme()) || !HOST.equals(url.getEncodedAuthority())) return unavailable();
                String path = url.getEncodedPath();
                if (path == null) return unavailable();
                if (!request.isForMainFrame() && isVendorApi(path, request.getMethod())) return null;
                if (!"GET".equals(request.getMethod()) || !path.startsWith(LOCAL)) return unavailable();
                return asset(path.substring(LOCAL.length()));
            }
        });
        setContentView(web);
        // Mesma origem da API, mas a página é entregue pelo APK, inclusive sem rede.
        web.loadUrl("https://" + HOST + LOCAL + "index.html");
    }

    private static boolean isVendorApi(String path, String method) {
        if ((API + "/sessao/app").equals(path)) return "POST".equals(method) || "DELETE".equals(method);
        if ((API + "/pedidos/campo").equals(path) || (API + "/cadastros/campo/cliente").equals(path)) {
            return "GET".equals(method) || "POST".equals(method);
        }
        if ((API + "/cadastros/campo/catalogo").equals(path) || (API + "/cadastros/campo/clientes").equals(path)) {
            return "GET".equals(method);
        }
        return PEDIDO.matcher(path).matches()
            && ("GET".equals(method) || ("POST".equals(method) && path.endsWith("/correcoes")));
    }

    private WebResourceResponse asset(String name) {
        String mime;
        switch (name) {
            case "index.html": mime = "text/html"; break;
            case "mobile.css": mime = "text/css"; break;
            case "acompanhamento.js": mime = "text/javascript"; break;
            default: return unavailable();
        }
        try {
            return new WebResourceResponse(mime, "UTF-8", getAssets().open(name));
        } catch (IOException ignored) {
            return unavailable();
        }
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
            setContentView(new FrameLayout(this));
            web.destroy();
        }
        super.onDestroy();
    }
}
