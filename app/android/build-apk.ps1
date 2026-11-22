# 用 Android SDK 里的命令行工具直接产出签名 APK，不依赖 Gradle。
#
# 前置：先在 app/web 下构建直连产物
#   $env:VITE_APK="1"; $env:VITE_DIRECT="1"; npx vite build
#
# 用法：
#   pwsh -File build-apk.ps1                      # 正式包
#   pwsh -File build-apk.ps1 -DebugOverlay        # 带调试浮层，用于排查白屏
# 产物：out/cqupt-yikatong-<version>.apk

param(
    [string]$Sdk = "C:\Users\Lenovo\AppData\Local\Android\Sdk",
    [string]$BuildTools = "36.0.0",
    [string]$Platform = "android-36",
    [string]$Version = "1.0.5",
  [string]$Package = "com.cqupt.card",
  [string]$Suffix = "",
    [switch]$DebugOverlay
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# versionCode 从版本号推导（1.0.10 → 10010），保证单调递增且不用手动维护
$VersionCode = 0
$vp = $Version.Split(".")
if ($vp.Count -ge 3) {
    $VersionCode = [int]$vp[0] * 10000 + [int]$vp[1] * 100 + [int]$vp[2]
} else {
    throw "版本号格式应为 x.y.z（收到 $Version）"
}

$webDist = Join-Path (Split-Path -Parent $root) "web\dist-apk"
$work = Join-Path $root "build"
$out = Join-Path $root "out"

$BT = Join-Path $Sdk "build-tools\$BuildTools"
$androidJar = Join-Path $Sdk "platforms\$Platform\android.jar"
$keytool = "C:\Program Files\Java\jdk-17.0.20\bin\keytool.exe"
$keystore = Join-Path $root "release.jks"
$storePass = "cquptcard"
$alias = "cqupt"

function Step($name) { Write-Host "`n==> $name" -ForegroundColor Cyan }
function Need($path, $what) { if (-not (Test-Path $path)) { throw "缺少${what}：$path" } }

Need $androidJar "android.jar"
Need (Join-Path $BT "aapt2.exe") "aapt2"
Need $webDist "前端产物（先跑 vite build，VITE_APK=1）"

if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory -Path $work, $out -Force | Out-Null

# ---------------------------------------------------------------- 1. assets
Step "1/7 准备 assets/www"
$www = Join-Path $work "assets\www"
New-Item -ItemType Directory -Path $www -Force | Out-Null
# 只带 index.html + 待内联的 app.js / app.css：
# manifest.webmanifest / icon.svg 是给浏览器 PWA 用的，APK 里纯属冗余，不带。
Copy-Item "$webDist\index.html" $www -Force
Copy-Item "$webDist\app.js" $www -Force
Copy-Item "$webDist\app.css" $www -Force

# file:// 下 ES module 会被 CORS 拒绝，产物已是 IIFE，这里把 module 标记去掉
$indexPath = Join-Path $www "index.html"
$html = Get-Content $indexPath -Raw
$html = $html -replace ' type="module"', '' -replace ' crossorigin', ''

# 把 css / js 内联进页面并把主脚本挪到 body 末尾：
# 1) WebView 里外链脚本的加载容易出岔子，内联后整页自包含、无额外请求；
# 2) 主脚本必须等 #app 进入 DOM 之后才能 mount。
$jsPath = Join-Path $www "app.js"
$cssPath = Join-Path $www "app.css"
Need $jsPath "app.js（构建产物）"
Need $cssPath "app.css（构建产物）"

$appJs = (Get-Content $jsPath -Raw) -replace '</script', '<\/script'
$appCss = Get-Content $cssPath -Raw

$html = $html.Replace('<script src="./app.js"></script>', '')
$html = $html.Replace('<link rel="stylesheet" href="./app.css">', "<style>`n$appCss`n</style>")

if ($DebugOverlay) {
    $hook = @'
<div id="boot-log" style="position:fixed;inset:0;z-index:99999;background:#fff;color:#b00;font:12px/1.5 monospace;white-space:pre-wrap;padding:10px;overflow:auto">[boot]
</div>
<script>
(function(){
  var d=document.getElementById('boot-log');
  function log(m){ if(d) d.textContent += m+"\n"; }
  window.addEventListener('error', function(e){
    log('ERROR: '+(e.message||'')+' @ '+(e.filename||'')+':'+(e.lineno||''));
  });
  window.addEventListener('unhandledrejection', function(e){
    var r=e.reason; log('REJECT: '+((r&&(r.stack||r.message))||r));
  });
  setTimeout(function(){
    var a=document.querySelector('#app');
    if(!a || a.children.length===0){ log('WARN: #app 仍为空，主脚本没跑起来'); }
    else { log('OK: 已挂载'); }
  }, 2500);
})();
</script>
'@
    $html = $html.Replace('<div id="app"></div>', "<div id=`"app`"></div>`n$hook")
    Write-Host "   已注入调试浮层"
}

$html = $html.Replace('</body>', "<script>`n$appJs`n</script>`n</body>")
Set-Content -Path $indexPath -Value $html -NoNewline -Encoding UTF8
Remove-Item $jsPath, $cssPath -Force
Write-Host "   index.html 自包含（约 $([math]::Round($html.Length / 1KB)) KB）"

# ------------------------------------------------------- 2. 编译资源与清单
Step "2/7 aapt2 compile + link"
$resZip = Join-Path $work "res.zip"
& (Join-Path $BT "aapt2.exe") compile --dir (Join-Path $root "res") -o $resZip
if ($LASTEXITCODE -ne 0) { throw "aapt2 compile 失败" }

$baseApk = Join-Path $work "base.apk"
$genDir = Join-Path $work "gen"
New-Item -ItemType Directory -Path $genDir -Force | Out-Null

# aapt2 的 --version-code/--version-name 只在清单里没写时才生效，所以这里生成一份临时清单替换版本号
$manSrc = Join-Path $root "AndroidManifest.xml"
$manTmp = Join-Path $work "AndroidManifest.gen.xml"
$mt = [System.IO.File]::ReadAllText($manSrc)
$mt = [regex]::Replace($mt, 'android:versionCode="\d+"', "android:versionCode=`"$VersionCode`"")
$mt = [regex]::Replace($mt, 'android:versionName="[^"]*"', "android:versionName=`"$Version`"")
[System.IO.File]::WriteAllText($manTmp, $mt, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "   版本：$Version（versionCode $VersionCode）"

& (Join-Path $BT "aapt2.exe") link `
    -o $baseApk `
    -I $androidJar `
    --manifest $manTmp `
    -R $resZip `
    --java $genDir `
    --auto-add-overlay `
    --rename-manifest-package $Package
if ($LASTEXITCODE -ne 0) { throw "aapt2 link 失败" }

# ------------------------------------------------------------------ 3. javac
Step "3/7 javac"
$classes = Join-Path $work "classes"
New-Item -ItemType Directory -Path $classes -Force | Out-Null
$sources = @()
$sources += Get-ChildItem $genDir -Recurse -Filter *.java | ForEach-Object { $_.FullName }
$sources += Get-ChildItem (Join-Path $root "src") -Recurse -Filter *.java | ForEach-Object { $_.FullName }

# 支付宝 SDK 的 classes.jar（官方 PayTask，用来唤起支付宝收银台）
$aliJar = Join-Path $root "libs\alipaysdk\classes.jar"
if (-not (Test-Path $aliJar)) { throw "缺少支付宝 SDK：$aliJar" }

& javac -encoding UTF-8 -source 8 -target 8 -nowarn `
    -bootclasspath $androidJar -classpath "$androidJar;$aliJar" `
    -d $classes $sources
if ($LASTEXITCODE -ne 0) { throw "javac 失败" }

# --------------------------------------------------------------- 4. dex
Step "4/7 R8 → classes.dex（shrink + optimize，-dontobfuscate 保类名）"
$classesJar = Join-Path $work "classes.jar"
& (Join-Path "C:\Program Files\Java\jdk-17.0.20\bin" "jar.exe") cf $classesJar -C $classes .
$dexDir = Join-Path $work "dex"
New-Item -ItemType Directory -Path $dexDir -Force | Out-Null
# 用 R8 而不是 d8：d8 只做 dex 化，会把支付宝 SDK 里没被引用到的类全部塞进来（dex 348 KB）；
# R8 的 shrinking 能砍到 ~214 KB，APK 整体少 ~55 KB。
# 刻意 -dontobfuscate：混淆只再多省 2 KB，却可能破坏 SDK 的反射调用，不值得。
$pgConf = Join-Path $root "proguard-rules.pro"
if (-not (Test-Path $pgConf)) { throw "缺少 $pgConf" }
& java -cp (Join-Path $BT "lib\d8.jar") com.android.tools.r8.R8 `
    --release --min-api 24 --lib $androidJar --output $dexDir `
    $classesJar $aliJar --pg-conf $pgConf
if ($LASTEXITCODE -ne 0) { throw "R8 失败" }

# ------------------------------------------------- 5. 写入 assets 与 classes.dex
Step "5/7 打包 assets 与 classes.dex"
$unsigned = Join-Path $work "unsigned.apk"
Copy-Item $baseApk $unsigned -Force

# 用 .NET 写入：Windows 版 aapt2 的 -A 会把条目名写成反斜杠，而 AssetManager 只认正斜杠
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($unsigned, "Update")
try {
    $prefixLen = $www.Length + 1
    Get-ChildItem $www -Recurse -File | ForEach-Object {
        $rel = "assets/www/" + $_.FullName.Substring($prefixLen).Replace("\", "/")
        $entry = $zip.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
        $dst = $entry.Open()
        $src = [System.IO.File]::OpenRead($_.FullName)
        $src.CopyTo($dst)
        $src.Close()
        $dst.Close()
        Write-Host "   + $rel ($([math]::Round($_.Length / 1KB)) KB)"
    }
    $dexEntry = $zip.CreateEntry("classes.dex", [System.IO.Compression.CompressionLevel]::Optimal)
    $dst = $dexEntry.Open()
    $src = [System.IO.File]::OpenRead((Join-Path $dexDir "classes.dex"))
    $src.CopyTo($dst)
    $src.Close()
    $dst.Close()
    Write-Host "   + classes.dex"
} finally {
    $zip.Dispose()
}

# ------------------------------------------------------------- 6. zipalign
Step "6/7 zipalign"
$aligned = Join-Path $work "aligned.apk"
& (Join-Path $BT "zipalign.exe") -p -f 4 $unsigned $aligned
if ($LASTEXITCODE -ne 0) { throw "zipalign 失败" }

# ------------------------------------------------------------- 7. 签名
Step "7/7 签名"
if (-not (Test-Path $keystore)) {
    & $keytool -genkeypair -v `
        -keystore $keystore -alias $alias `
        -keyalg RSA -keysize 2048 -validity 10000 `
        -storepass $storePass -keypass $storePass `
        -dname "CN=CQUPT Card, OU=Student Project, O=CQUPT, L=Chongqing, ST=Chongqing, C=CN"
    if ($LASTEXITCODE -ne 0) { throw "生成 keystore 失败" }
    Write-Host "   已生成 $keystore（口令 $storePass）"
} else {
    Write-Host "   复用已有 $keystore"
}

$final = Join-Path $out "cqupt-yikatong-$Version$Suffix.apk"
& (Join-Path $BT "apksigner.bat") sign `
    --ks $keystore --ks-key-alias $alias `
    --ks-pass "pass:$storePass" --key-pass "pass:$storePass" `
    --min-sdk-version 24 --max-sdk-version 34 `
    --out $final $aligned
if ($LASTEXITCODE -ne 0) { throw "apksigner sign 失败" }

& (Join-Path $BT "apksigner.bat") verify --print-certs $final | Select-Object -First 6

$size = [math]::Round((Get-Item $final).Length / 1KB)
Write-Host "`n完成：$final（$size KB）" -ForegroundColor Green
