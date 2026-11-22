# 必须保留运行时注解：@JavascriptInterface 是 RUNTIME 保留，
# 被 R8 剥掉之后 WebView 就不会把 PayBridge 的方法暴露给 JS，
# 表现就是「桥对象在、方法全没了」，支付静默退化成 scheme 兜底。
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes InnerClasses
-keepattributes EnclosingMethod
# 我们自己的入口与 JS 桥（反射调用，必须保留）
# 注意内部类要单独 keep：只写 MainActivity 不会连带保住 MainActivity$PayBridge，
# 上一版就是漏了这条，R8 把 hasAlipay() 当未引用方法删掉，支付退化成 scheme 兜底。
-keep class com.cqupt.card.MainActivity { *; }
-keep class com.cqupt.card.MainActivity$* { *; }
-keep class com.cqupt.card.** { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# 支付宝 SDK 官方 consumer 规则
-keep class com.alipay.android.app.IAlixPay{*;}
-keep class com.alipay.android.app.IAlixPay$Stub{*;}
-keep class com.alipay.android.app.IRemoteServiceCallback{*;}
-keep class com.alipay.android.app.IRemoteServiceCallback$Stub{*;}
-keep class com.alipay.sdk.app.PayTask{ public *;}
-keep class com.alipay.sdk.app.AuthTask{ public *;}
-keep class com.alipay.sdk.app.H5PayCallback { <fields>; <methods>; }
-keep class com.alipay.android.phone.mrpc.core.** { *; }
-keep class com.alipay.apmobilesecuritysdk.** { *; }
-keep class com.alipay.mobile.framework.service.annotation.** { *; }
-keep class com.alipay.mobilesecuritysdk.face.** { *; }
-keep class com.alipay.tscenter.biz.rpc.** { *; }
-keep class org.json.alipay.** { *; }
-keep class com.alipay.tscenter.** { *; }
-keep class com.ta.utdid2.** { *;}
-keep class com.ut.device.** { *;}

-dontwarn **
-dontobfuscate
