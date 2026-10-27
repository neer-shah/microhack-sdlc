locals {
  name = "${var.project}-${var.environment}"
  tags = merge({ project = var.project, environment = var.environment, managed_by = "terraform" }, var.tags)
}

resource "random_string" "suffix" {
  length  = 5
  upper   = false
  special = false
}

resource "azurerm_resource_group" "main" {
  name     = "rg-${local.name}"
  location = var.location
  tags     = local.tags
}

# ---------- Supporting services ----------

resource "azurerm_log_analytics_workspace" "main" {
  name                = "log-${local.name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = var.log_retention_days
  tags                = local.tags
}

resource "azurerm_application_insights" "main" {
  name                = "appi-${local.name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  workspace_id        = azurerm_log_analytics_workspace.main.id
  application_type    = "web"
  tags                = local.tags
}

resource "azurerm_container_registry" "main" {
  name                = "acr${var.project}${var.environment}${random_string.suffix.result}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = var.acr_sku
  admin_enabled       = false
  tags                = local.tags
}

# ---------- Storage / database (SQLite file on Azure Files) ----------

resource "azurerm_storage_account" "data" {
  name                            = "st${var.project}${var.environment}${random_string.suffix.result}"
  location                        = azurerm_resource_group.main.location
  resource_group_name             = azurerm_resource_group.main.name
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  tags                            = local.tags
}

resource "azurerm_storage_share" "db" {
  name               = "sqlite-data"
  storage_account_id = azurerm_storage_account.data.id
  quota              = var.db_share_quota_gb
}

# ---------- Compute ----------

resource "azurerm_service_plan" "main" {
  name                = "asp-${local.name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  os_type             = "Linux"
  sku_name            = var.app_service_sku
  tags                = local.tags
}

resource "azurerm_linux_web_app" "api" {
  name                = "app-${local.name}-api-${random_string.suffix.result}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  service_plan_id     = azurerm_service_plan.main.id
  https_only          = true
  tags                = local.tags

  identity {
    type = "SystemAssigned"
  }

  site_config {
    always_on                               = true
    health_check_path                       = "/api-docs"
    container_registry_use_managed_identity = true
    ftps_state                              = "Disabled"
    minimum_tls_version                     = "1.2"

    application_stack {
      docker_image_name   = "octocat-api:${var.api_image_tag}"
      docker_registry_url = "https://${azurerm_container_registry.main.login_server}"
    }
  }

  storage_account {
    name         = "sqlite"
    type         = "AzureFiles"
    account_name = azurerm_storage_account.data.name
    share_name   = azurerm_storage_share.db.name
    access_key   = azurerm_storage_account.data.primary_access_key
    mount_path   = "/app/data"
  }

  app_settings = {
    WEBSITES_PORT                         = "3000"
    PORT                                  = "3000"
    NODE_ENV                              = "production"
    DB_ENGINE                             = "sqlite"
    DB_FILE                               = "/app/data/app.db"
    DB_ENABLE_WAL                         = "false" # WAL is unreliable on SMB shares
    API_CORS_ORIGINS                      = "https://app-${local.name}-web-${random_string.suffix.result}.azurewebsites.net"
    APPLICATIONINSIGHTS_CONNECTION_STRING = azurerm_application_insights.main.connection_string
  }
}

resource "azurerm_linux_web_app" "frontend" {
  name                = "app-${local.name}-web-${random_string.suffix.result}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  service_plan_id     = azurerm_service_plan.main.id
  https_only          = true
  tags                = local.tags

  identity {
    type = "SystemAssigned"
  }

  site_config {
    always_on                               = true
    container_registry_use_managed_identity = true
    ftps_state                              = "Disabled"
    minimum_tls_version                     = "1.2"

    application_stack {
      docker_image_name   = "octocat-frontend:${var.frontend_image_tag}"
      docker_registry_url = "https://${azurerm_container_registry.main.login_server}"
    }
  }

  app_settings = {
    WEBSITES_PORT = "80"
    API_HOST      = azurerm_linux_web_app.api.default_hostname
    API_PORT      = "443"
  }
}

# Allow both apps to pull images from ACR via managed identity
resource "azurerm_role_assignment" "acr_pull_api" {
  scope                = azurerm_container_registry.main.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_linux_web_app.api.identity[0].principal_id
}

resource "azurerm_role_assignment" "acr_pull_frontend" {
  scope                = azurerm_container_registry.main.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_linux_web_app.frontend.identity[0].principal_id
}

# ---------- Diagnostics ----------

resource "azurerm_monitor_diagnostic_setting" "api" {
  name                       = "diag-api"
  target_resource_id         = azurerm_linux_web_app.api.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category = "AppServiceHTTPLogs"
  }
  enabled_log {
    category = "AppServiceConsoleLogs"
  }
  enabled_metric {
    category = "AllMetrics"
  }
}

resource "azurerm_monitor_diagnostic_setting" "frontend" {
  name                       = "diag-frontend"
  target_resource_id         = azurerm_linux_web_app.frontend.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category = "AppServiceHTTPLogs"
  }
  enabled_log {
    category = "AppServiceConsoleLogs"
  }
  enabled_metric {
    category = "AllMetrics"
  }
}
