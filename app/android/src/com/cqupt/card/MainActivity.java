package com.cqupt.card;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.Locale;

import com.alipay.sdk.app.PayTask;
import com.alipay.sdk.app.AuthTask;

/**
 * 一个最小 WebView 壳：界面全部是 assets/www 里的前端产物，
 * 数据由前端自己直连学校一卡通网关（不经过任何第三方服务器）。
 *
 * 两个必须打开的开关：
 *  - setAllowUniversalAccessFromFileURLs：页面以 file:// 启动，只有打开它，
 *    页面里的 XHR 才能访问 http://202.202.43.47 并读到响应（否则被 CORS 拦掉）；
 *  - setMixedContentMode(ALWAYS_ALLOW)：学校网关是 http，别让 WebView 拦成混合内容。
 */
public class MainActivity extends Activity {

    private static final String ENTRY = "file:///android_asset/www/index.html";
    private static final int BG_LIGHT = Color.parseColor("#F6F8FA");

    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        window.setStatusBarColor(BG_LIGHT);
        window.setNavigationBarColor(BG_LIGHT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            // 浅色状态栏需要深色图标
            window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        }

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);
        s.setUseWideViewPort(false);

        web.setBackgroundColor(BG_LIGHT);
        web.setOverScrollMode(View.OVER_SCROLL_IF_CONTENT_SCROLLS);
        web.setWebChromeClient(new WebChromeClient());
        // 前端通过 window.AndroidPay.alipay(orderInfo) 直接走支付宝官方 SDK
        web.addJavascriptInterface(new PayBridge(), "AndroidPay");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl().toString());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(url);
            }
        });

        // 允许用 chrome://inspect 连上来排查页面问题
        WebView.setWebContentsDebuggingEnabled(true);

        setContentView(web);
        web.loadUrl(ENTRY);
    }

    /**
     * 暴露给前端的桥：只有"发起支付宝支付"这一件事。
     * 用官方 PayTask 而不是 alipays:// scheme —— 后者只服务 H5 支付，
     * 把 APP 支付的 orderInfo 塞进 url 参数，支付宝起来后会静默退出（真机实测）。
     */
    public class PayBridge {
        /**
         * 从 PayTask 的返回串里抠一个字段。
         * 两种格式都要吃得下：
         *   resultStatus={9000};memo={};result={...}   ← 老格式，值外面套花括号
         *   {"resultStatus":"9000","memo":""}          ← 新格式，JSON
         */
        private String pick(String raw, String key) {
            if (raw == null || raw.length() == 0) {
                return "";
            }
            java.util.regex.Matcher m = java.util.regex.Pattern
                    .compile(key + "[\"']?\\s*[=:]\\s*[\"{]?([^\"};]*)")
                    .matcher(raw);
            if (!m.find()) {
                return "";
            }
            return m.group(1).replace("\"", "").trim();
        }

        @JavascriptInterface
        public void alipay(final String orderInfo) {
            // 用匿名内部类而不是 lambda：本工程 javac 以 android.jar 当 bootclasspath，
            // 里面没有 java.lang.invoke.LambdaMetafactory，lambda 编不过
            new Thread(new Runnable() {
                @Override
                public void run() {
                    String raw;
                    try {
                        raw = new PayTask(MainActivity.this).pay(orderInfo, true);
                    } catch (Throwable e) {
                        raw = "resultStatus=4000;memo=" + e.getClass().getSimpleName();
                    }
                    final String result = raw == null ? "" : raw;
                    android.util.Log.d("PayBridge", "raw=" + result);
                    /*
                     * 解析放在 Java 侧做，只把 status / memo 两个字段交给前端。
                     * 之前前端用 /resultStatus=(\d+)/ 直接匹配原始串，碰上老格式的
                     * resultStatus={9000} 匹配不到数字，于是一律落到「支付未完成」——
                     * 钱扣了、余额也到账了，界面却说没付成功。
                     */
                    final String status = pick(result, "resultStatus");
                    final String memo = pick(result, "memo");
                    final String payload = "{\"status\":" + JSONObject.quote(status)
                            + ",\"memo\":" + JSONObject.quote(memo)
                            + ",\"raw\":" + JSONObject.quote(result) + "}";
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (web != null) {
                                web.evaluateJavascript(
                                        "window.__alipayResult && window.__alipayResult("
                                                + JSONObject.quote(payload) + ")",
                                        null);
                            }
                        }
                    });
                }
            }, "alipay-pay").start();
        }

        @JavascriptInterface
        public boolean hasAlipay() {
            try {
                getPackageManager().getPackageInfo("com.eg.android.AlipayGphone", 0);
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        /**
         * 支付宝授权：getAlipaySign 返回的 authInfo 直接喂给 AuthTask，换 authCode 用于绑定。
         * 结果回调到 window.__alipayAuth(payload)，payload = {code,status,memo,raw}。
         */
        @JavascriptInterface
        public void auth(final String authInfo) {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    String raw;
                    try {
                        raw = new AuthTask(MainActivity.this).auth(authInfo, true);
                    } catch (Throwable e) {
                        raw = "{\"resultCode\":\"4000\",\"memo\":\"" + e.getClass().getSimpleName() + "\"}";
                    }
                    final String result = raw == null ? "" : raw;
                    android.util.Log.d("PayBridge", "auth=" + result);
                    final String code = pick(result, "authCode");
                    final String status = pick(result, "resultCode");
                    final String memo = pick(result, "memo");
                    final String payload = "{\"code\":" + JSONObject.quote(code)
                            + ",\"status\":" + JSONObject.quote(status)
                            + ",\"memo\":" + JSONObject.quote(memo)
                            + ",\"raw\":" + JSONObject.quote(result) + "}";
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (web != null) {
                                web.evaluateJavascript(
                                        "window.__alipayAuth && window.__alipayAuth("
                                                + JSONObject.quote(payload) + ")",
                                        null);
                            }
                        }
                    });
                }
            }, "alipay-auth").start();
        }
    }
    /**
     * 返回 true 表示我们自己处理了这一跳，WebView 不再导航。
     * 站内请求（file://、学校网关域名）留在 WebView；其余交给系统。
     */
    private boolean handleUrl(String url) {
        if (url == null) return false;
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);

        if ("file".equals(scheme) || "about".equals(scheme) || "data".equals(scheme)) return false;
        if (("http".equals(scheme) || "https".equals(scheme)) && url.contains("202.202.43.")) return false;

        boolean pay = "alipays".equals(scheme) || "alipayqr".equals(scheme)
                || "weixin".equals(scheme) || "weixinpay".equals(scheme);

        if (pay) {
            if (openByScheme(url)) return true;
            Toast.makeText(this, "这台设备上没有装 " + scheme + " 对应的应用", Toast.LENGTH_LONG).show();
            return true;
        }

        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception e) {
            Toast.makeText(this, "打不开这个链接", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    /**
     * 支付类 scheme 用 Intent.parseUri 解析：alipays://platformapi/startapp?... 这类地址
     * 里带着 package、endpoint 等参数，裸 ACTION_VIEW 会丢，parseUri 能原样带过去。
     */
    private boolean openByScheme(String url) {
        try {
            Intent i = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            i.setComponent(null);
            i.setSelector(null);
            startActivity(i);
            return true;
        } catch (Exception e) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                return true;
            } catch (Exception ignored) {
                return false;
            }
        }
    }
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web != null && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.setWebChromeClient(null);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
