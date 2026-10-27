# Deploy OctoCAT with Bicep

This deploys the TypeScript API and React frontend to Azure Container Apps.
Terraform is not used. Azure CLI is still required: Bicep does not replace Azure
authentication or the CLI.

## Prerequisites

- Install Azure CLI: `winget install --exact --id Microsoft.AzureCLI`, then fully
  restart VS Code so `az version` works.
- Sign in with `az login`. If needed, use `az login --use-device-code`.
- Your account needs resource creation and role-assignment permissions (for
  example Contributor plus User Access Administrator) and permission to run
  ACR Tasks builds. The script skips already registered resource providers.
  Registering missing providers requires subscription-level permission.
- Azure resources and cloud builds incur charges. ACR Tasks availability depends
  on subscription policy; the script stops and reports any build failures.

## Run from the repository root in PowerShell

```powershell
az login
.\infra\deploy.ps1 -SubscriptionId "9158b657-d9c9-47c8-9227-776ca088fab7"
```

Optional arguments: `-ResourceGroup rg-octocat-dev -Location westeurope
-NamePrefix octocat -EnvironmentName dev`. Reuse these values on later runs.

The script compiles Bicep, provisions supporting resources, builds both images
using `az acr build` (no local Docker required), then deploys the apps with a
unique image tag. It checks both HTTP endpoints and prints their URLs.
Open the frontend and verify login, products and cart; HTTP readiness alone
does not validate those flows. If local script execution is restricted, use
your organization's approved PowerShell execution policy.

## Resources and runtime wiring

- Basic ACR, admin credentials disabled; a user-assigned managed identity gets
  `AcrPull` for both apps.
- Consumption Container Apps environment, Log Analytics (30-day retention).
- Two HTTPS apps, 0.5 vCPU / 1 GiB each, one replica and single active revision.
- The browser calls the API's public HTTPS FQDN directly through frontend
  runtime configuration, not an nginx reverse proxy. API CORS allows exactly
  the frontend origin. The API remains publicly reachable.
- Azure Files share mounted at `/app/data`, `DB_FILE=/app/data/app.db`, WAL
  disabled. The API initializes/seeds its database at startup.

**Demo database limitation:** SQLite on SMB has locking and performance risks.
One replica and disabled WAL do not make this a production database. Revision
rollouts may briefly overlap; avoid writes during deployments. Do not scale
out. For production, migrate the application data layer to a managed database
and add backups, private networking and application telemetry.

`main.parameters.json` contains optional non-secret defaults. `deployApps=false`
is the bootstrap phase: it creates supporting resources without requiring images.
Resource-group deployments are incremental; no placeholder containers are needed.
The PowerShell script provisions infrastructure using Bicep. The GitHub Actions
workflow below is a separate **redeploy-only** path for already provisioned apps.

## Redeploy existing apps with GitHub Actions

[deploy.yml](../.github/workflows/deploy.yml) runs manually: API build/tests,
frontend build, OIDC login, Docker image build/push to the existing registry,
then API and frontend updates followed by HTTP checks. It does not provision
Bicep resources, register providers, migrate local data, or deploy Azure SQL.
Incomplete Azure SQL application changes were removed when that work was paused.

In GitHub **Settings > Secrets and variables > Actions**, configure:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `AZURE_CLIENT_ID` | Client ID of the deployment identity (not the image-pull identity unless separately authorized) |
| Secret | `AZURE_TENANT_ID` | Azure tenant ID |
| Secret | `AZURE_SUBSCRIPTION_ID` | `9158b657-d9c9-47c8-9227-776ca088fab7` |
| Variable | `AZURE_RESOURCE_GROUP` | `rg-labuser-0039` |
| Variable | `AZURE_ACR_NAME` | `octo0039mwp5jzm7c2jqw` |
| Variable | `AZURE_API_APP` | `octo0039-lab-api` |
| Variable | `AZURE_FRONTEND_APP` | `octo0039-lab-frontend` |

The deployment identity needs Contributor on the existing resource group,
`AcrPush` on the registry, and Managed Identity Operator on the apps' assigned
identity where Azure requires identity assignment authorization. The apps retain
their own managed identity and its `AcrPull` permission.
Configure GitHub OIDC federation on the deployment identity with issuer
`https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`,
and subject `repo:neer-shah/microhack-sdlc:ref:refs/heads/main` for runs from `main`.
For another branch use its exact subject; do not broaden access unnecessarily.
No Azure client secret is needed.

Commit and push the workflow, frontend proxy changes, and current application
code to GitHub. Then select **Actions > Redeploy to Azure > Run workflow** on the
authorized branch. Check the demo-data reset acknowledgement and run. The verified
frontend URL appears in the run summary. Automatic push deployment is disabled.

This workflow deliberately keeps API ingress internal. The frontend sets
`API_PROXY_ENABLED=true`: nginx proxies `/api` to the internal API's HTTPS FQDN,
and runtime configuration uses `window.location.origin`. Browser cookies and API
requests stay same-origin. With the flag unset/false, the image preserves its
previous direct-to-API runtime configuration. Invalid flag values fail startup.
Both apps must share a Container Apps environment. The workflow aligns API CORS
with the frontend origin and tests that unknown-account login returns HTTP 401.

**Data warning:** the existing lab API has no database volume. Its container-local
SQLite data may reset during redeployment. The workflow requires explicit
acknowledgement each run and does not migrate or preserve that data. Use only demo
data. Azure SQL work is paused; the application continues to use SQLite.

## Troubleshooting

If `Microsoft.App/register/action` (or another provider registration) is denied,
ask your subscription administrator or lab facilitator to register the following
providers on your subscription: `Microsoft.App`, `Microsoft.ContainerRegistry`,
`Microsoft.OperationalInsights`, `Microsoft.ManagedIdentity`, `Microsoft.Storage`.
The administrator can run `az provider register --namespace Microsoft.App --wait`
and repeat for the other missing providers. Rerun the script afterward; it checks
registration state before attempting registration. Do not ignore a missing provider
or try to bypass the subscription's permissions.

Lab accounts may also be restricted to a pre-created resource group. In that case,
pass its name with `-ResourceGroup <assigned-resource-group>`; your account still
needs the permissions listed above within that scope.

```powershell
az containerapp logs show -g rg-octocat-dev -n octocat-dev-api --type console --tail 100
az containerapp logs show -g rg-octocat-dev -n octocat-dev-frontend --type console --tail 100
```

Image-pull failures immediately after bootstrap can be caused by role propagation;
wait a few minutes and rerun the script. It stops on CLI or readiness errors rather
than reporting a successful deployment.

To remove these resources, verify the resource group contains only this deployment,
then run the following destructive command:

```powershell
az group delete --name rg-octocat-dev
```
