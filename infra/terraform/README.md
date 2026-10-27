# OctoCAT infrastructure (Terraform, Azure)

Scaffolds:

- **Compute**: Linux App Service plan, two container web apps (`api` from `src/api-ts`, `frontend` from `src/frontend`), pulling from ACR via managed identity (AcrPull).
- **Storage/database**: Storage account + Azure Files share mounted at `/app/data` for the SQLite file (`DB_FILE=/app/data/app.db`). WAL is disabled because it is unreliable on SMB.
- **Supporting**: Container Registry, Log Analytics, Application Insights, diagnostic settings.

## Use

```powershell
cd infra/terraform
terraform init
terraform apply -var subscription_id=<id>

# build and push images to the acr_login_server output
az acr login --name <acr-name>
docker build -t <acr>/octocat-api:latest src/api-ts; docker push <acr>/octocat-api:latest
docker build -t <acr>/octocat-frontend:latest src/frontend; docker push <acr>/octocat-frontend:latest
```

Notes:
- SQLite on Azure Files suits a single instance only; do not scale out. For production, move to Azure SQL/PostgreSQL.
- The API health check uses `/api-docs` (Swagger); adjust if the route differs.
- Add a remote `backend "azurerm"` block for shared state.
