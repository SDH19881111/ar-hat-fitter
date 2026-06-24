# AR 전통 모자 피팅룸 로컬 웹 서버 (PowerShell 전용)
# 외부 설치 파일(Node.js, Python 등) 없이 Windows 순정 환경에서 바로 웹 서버를 띄워줍니다.

$port = 8080
$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrEmpty($rootDir)) {
    $rootDir = Get-Location
}

# HttpListener 생성 및 설정
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")

try {
    $listener.Start()
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host " AR전통 모자 피팅룸 로컬 서버가 시작되었습니다!" -ForegroundColor Green
    Write-Host " URL: http://localhost:$port/" -ForegroundColor Cyan
    Write-Host " 종료하려면 이 터미널 창에서 Ctrl + C를 누르세요." -ForegroundColor Yellow
    Write-Host "==========================================================" -ForegroundColor Green
    
    # 기본 브라우저로 접속 주소 자동 열기
    Start-Process "http://localhost:$port/"

    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        # URL 경로 매핑
        $urlPath = $request.Url.LocalPath
        if ($urlPath -eq "/") {
            $urlPath = "/index.html"
        }

        # 로컬 파일 경로 생성 (URL 경로 구분자 변환)
        $filePath = Join-Path $rootDir $urlPath.Replace("/", "\").TrimStart("\")

        if (Test-Path $filePath -PathType Leaf) {
            # 파일 읽기 및 전송
            try {
                $bytes = [System.IO.File]::ReadAllBytes($filePath)
                
                # MIME 타입 지정
                $extension = [System.IO.Path]::GetExtension($filePath).ToLower()
                switch ($extension) {
                    ".html" { $response.ContentType = "text/html; charset=utf-8" }
                    ".css"  { $response.ContentType = "text/css" }
                    ".js"   { $response.ContentType = "application/javascript" }
                    ".png"  { $response.ContentType = "image/png" }
                    ".jpg"  { $response.ContentType = "image/jpeg" }
                    ".jpeg" { $response.ContentType = "image/jpeg" }
                    ".ico"  { $response.ContentType = "image/x-icon" }
                    ".wasm" { $response.ContentType = "application/wasm" }
                    default { $response.ContentType = "application/octet-stream" }
                }

                Write-Host "Request: $urlPath | Extension: $extension | Content-Type: $($response.ContentType)" -ForegroundColor Gray

                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            } catch {
                $response.StatusCode = 500
                $errMsg = [System.Text.Encoding]::UTF8.GetBytes("500 Internal Server Error: $($_.Exception.Message)")
                $response.OutputStream.Write($errMsg, 0, $errMsg.Length)
            }
        } else {
            # 404 Not Found
            $response.StatusCode = 404
            $notFoundMsg = [System.Text.Encoding]::UTF8.GetBytes("404 File Not Found: $urlPath")
            $response.OutputStream.Write($notFoundMsg, 0, $notFoundMsg.Length)
        }

        $response.OutputStream.Close()
    }
} catch {
    Write-Error "서버 시작 중 오류가 발생했습니다: $($_.Exception.Message)"
} finally {
    if ($listener.IsListening) {
        $listener.Stop()
    }
}
