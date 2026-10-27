[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SubscriptionId,
    [string]$ResourceGroup = 'rg-octocat-dev',
    [string]$Location = 'westeurope',
    [ValidatePattern('^[a-z][a-z0-9]{1,11}$')]
    [string]$NamePrefix = 'octocat',
    [ValidateSet('dev', 'test', 'prod')]
    [string]$EnvironmentName = 'dev',
    [ValidatePattern('^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$')]
    [string]$ImageTag = (Get-Date -Format 'yyyyMMddHHmmss')
)

$ErrorActionPreference = 'Stop'

function Invoke-Azure {
    param([string[]]$Arguments)
    & az @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI failed: az $($Arguments -join ' ')"
    }
}

if (-not (Get-Command az -CommandType Application -ErrorAction SilentlyContinue)) {
    throw 'Azure CLI (az) is not on PATH. Bicep also requires Azure CLI. Install Microsoft.AzureCLI and restart VS Code.'
}

Invoke-Azure -Arguments @('account', 'show', '--output', 'none')
Invoke-Azure -Arguments @('account', 'set', '--subscription', $SubscriptionId)
Invoke-Azure -Arguments @('bicep', 'install')
$template = Join-Path $PSScriptRoot 'main.bicep'
Invoke-Azure -Arguments @('bicep', 'build', '--file', $template, '--stdout') | Out-Null

foreach ($provider in @('Microsoft.App', 'Microsoft.ContainerRegistry', 'Microsoft.OperationalInsights', 'Microsoft.ManagedIdentity', 'Microsoft.Storage')) {
    $registrationState = Invoke-Azure -Arguments @(
        'provider', 'show', '--namespace', $provider,
        '--query', 'registrationState', '--output', 'tsv'
    )
    if ($registrationState -eq 'Registered') {
        continue
    }
    if ([string]::IsNullOrWhiteSpace($registrationState)) {
        throw "Could not determine registration state for $provider. Ask your Azure subscription administrator to check resource provider registration."
    }
    Write-Host "Registering resource provider $provider (current state: $registrationState)."
    Write-Host "This requires subscription-level registration permission. If denied, ask your subscription administrator to register $provider, then rerun this script."
    Invoke-Azure -Arguments @('provider', 'register', '--namespace', $provider, '--wait', '--output', 'none')
}

Invoke-Azure -Arguments @('group', 'create', '--name', $ResourceGroup, '--location', $Location, '--output', 'none')
$deployment = @(
    'deployment', 'group', 'create', '--resource-group', $ResourceGroup,
    '--template-file', $template, '--parameters',
    "namePrefix=$NamePrefix", "environmentName=$EnvironmentName", "imageTag=$ImageTag"
)

Write-Host 'Provisioning registry, identity, storage and Container Apps environment...'
$registry = Invoke-Azure -Arguments ($deployment + @(
    'deployApps=false', '--name', 'bootstrap', '--query', 'properties.outputs.acrName.value', '--output', 'tsv'
))
if ([string]::IsNullOrWhiteSpace($registry)) {
    throw 'Bootstrap deployment did not return the registry name.'
}
$root = Split-Path $PSScriptRoot -Parent
Write-Host 'Building images in Azure (no local Docker required)...'
Invoke-Azure -Arguments @('acr', 'build', '--registry', $registry, '--image', "api:$ImageTag", (Join-Path $root 'src\api-ts'))
Invoke-Azure -Arguments @('acr', 'build', '--registry', $registry, '--image', "frontend:$ImageTag", (Join-Path $root 'src\frontend'))

Write-Host 'Deploying application revisions...'
Invoke-Azure -Arguments ($deployment + @('deployApps=true', '--name', 'application', '--output', 'none'))
$outputs = Invoke-Azure -Arguments @(
    'deployment', 'group', 'show', '--resource-group', $ResourceGroup, '--name', 'application',
    '--query', 'properties.outputs', '--output', 'json'
) | ConvertFrom-Json

foreach ($url in @($outputs.apiUrl.value, $outputs.frontendUrl.value)) {
    $ready = $false
    for ($attempt = 1; $attempt -le 12; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20
            if ($response.StatusCode -eq 200) {
                $ready = $true
                break
            }
        } catch [System.Net.WebException] {
            Write-Warning "Waiting for $url ($attempt/12): $($_.Exception.Message)"
        }
        Start-Sleep -Seconds 10
    }
    if (-not $ready) {
        throw "Deployment completed but $url did not become ready. Check az containerapp logs show for the app."
    }
}
Write-Host "API: $($outputs.apiUrl.value)"
Write-Host "Frontend: $($outputs.frontendUrl.value)"
