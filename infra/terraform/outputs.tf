output "resource_group" {
  value = azurerm_resource_group.main.name
}

output "acr_login_server" {
  value = azurerm_container_registry.main.login_server
}

output "api_url" {
  value = "https://${azurerm_linux_web_app.api.default_hostname}"
}

output "frontend_url" {
  value = "https://${azurerm_linux_web_app.frontend.default_hostname}"
}

output "sqlite_storage_account" {
  value = azurerm_storage_account.data.name
}
