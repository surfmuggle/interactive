[CmdletBinding(PositionalBinding = $false)]
param (
    [switch]$ci,
    [switch]$noDotnet,
    [switch]$test,
    [Parameter(ValueFromRemainingArguments = $true)][String[]]$arguments
)

Set-StrictMode -version 2.0
$ErrorActionPreference = "Stop"

try {
    $repoRoot = Resolve-Path "$PSScriptRoot\.."
    $symlinkDirectories = @(
        "$repoRoot\src\microsoft-dotnet-interactive-browser\src\dotnet-interactive",
        "$repoRoot\src\dotnet-interactive-vscode-common\src\dotnet-interactive",
        "$repoRoot\src\dotnet-interactive-vscode\src\vscode-common",
        "$repoRoot\src\dotnet-interactive-vscode\tests\vscode-common-tests",
        "$repoRoot\src\dotnet-interactive-vscode-insiders\src\vscode-common",
        "$repoRoot\src\dotnet-interactive-vscode-insiders\tests\vscode-common-tests"
    )

    foreach ($symlinkDir in $symlinkDirectories) {
        $candidate = Get-Item $symlinkDir -ErrorAction SilentlyContinue
        if (($null -eq $candidate) -Or (-Not($candidate.Attributes -match "ReparsePoint"))) {
            throw "The directory '$symlinkDir' was not a symlink.  Please run the script '$repoRoot\src\ensure-symlinks.ps1' **AS ADMIN**."
        }
    }

    # build and test NPM
    $npmDirs = @(
        "src\microsoft-dotnet-interactive",
        "src\microsoft-dotnet-interactive-browser",
        "src\dotnet-interactive-vscode",
        "src\dotnet-interactive-vscode-insiders"
    )
    foreach ($npmDir in $npmDirs) {
        Push-Location "$repoRoot\$npmDir"
        Write-Host "Building NPM in directory $npmDir"
        npm ci
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        npm run compile
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

        if ($test) {
            Write-Host "Testing NPM in directory $npmDir"
            npm run ciTest
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        }

        Pop-Location
    }

    if (-Not $noDotnet) {
        # promote switches to arguments
        if ($ci) {
            $arguments += "-ci"
        }
        if ($test -And -Not($ci)) {
            # CI runs unit tests elsewhere, so only promote the `-test` switch if we're not running CI
            $arguments += '-test'
        }

        # invoke regular build/test script
        $buildScript = (Join-Path $PSScriptRoot "common\build.ps1")
        Invoke-Expression "$buildScript -projects ""$PSScriptRoot\..\dotnet-interactive.sln"" $arguments"
        if ($LASTEXITCODE -ne 0) {
            exit $LASTEXITCODE
        }
    }
}
catch {
    Write-Host $_
    Write-Host $_.Exception
    Write-Host $_.ScriptStackTrace
    exit 1
}
