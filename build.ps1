#requires -Version 7.4
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$files = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'rules') -Filter '*.json' -File | Sort-Object Name)
if ($files.Count -eq 0) { throw 'At least one rules/*.json file is required.' }

$rules = @(
    foreach ($file in $files) {
        $rule = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json -AsHashtable
        if ($rule -isnot [System.Collections.IDictionary] -or
            (@($rule.Keys | Sort-Object) -join ',') -cne 'hosts,includeSubdomains,paths') {
            throw "$($file.Name): expected hosts, includeSubdomains, and paths only."
        }
        if ($rule.hosts -isnot [array] -or $rule.hosts.Count -eq 0 -or
            $rule.includeSubdomains -isnot [bool] -or $rule.paths -isnot [array]) {
            throw "$($file.Name): hosts must be a nonempty array, includeSubdomains a boolean, and paths an array."
        }
        foreach ($hostName in $rule.hosts) {
            if ($hostName -isnot [string] -or $hostName.Length -gt 253 -or
                $hostName -cnotmatch '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$') {
                throw "$($file.Name): invalid lowercase hostname '$hostName'."
            }
        }
        foreach ($path in $rule.paths) {
            if ($path -isnot [string] -or -not $path.StartsWith('/') -or
                $path -match '[?#\\\s]' -or ($path.Length -gt 1 -and $path.EndsWith('/'))) {
                throw "$($file.Name): paths must be exact paths without query, fragment, whitespace, backslash, or trailing slash."
            }
        }
        foreach ($key in @('hosts', 'paths')) {
            if (@($rule[$key] | Sort-Object -Unique -CaseSensitive).Count -ne $rule[$key].Count) {
                throw "$($file.Name): duplicate $key."
            }
        }
        [ordered]@{
            hosts = $rule.hosts
            includeSubdomains = $rule.includeSubdomains
            paths = $rule.paths
        }
    }
)

$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'src/manage-site-access.js')).Replace("`r`n", "`n")
$marker = '__SITE_RULES__'
if ([regex]::Matches($source, $marker).Count -ne 1) { throw 'Source must contain exactly one rules marker.' }
$script = $source.Replace($marker, (ConvertTo-Json -InputObject $rules -Depth 5 -Compress))
$directory = Join-Path $PSScriptRoot 'dist'
[void][IO.Directory]::CreateDirectory($directory)
$output = Join-Path $directory 'manage-site-access.user.js'
[IO.File]::WriteAllText($output, $script, [Text.UTF8Encoding]::new($false))
Write-Output $output
