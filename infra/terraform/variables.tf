variable "subscription_id" {
  description = "Azure subscription ID."
  type        = string
}

variable "project" {
  description = "Short project name used as a prefix for resource names."
  type        = string
  default     = "octocat"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)."
  type        = string
  default     = "dev"
}

variable "location" {
  description = "Azure region."
  type        = string
  default     = "westeurope"
}

variable "app_service_sku" {
  description = "App Service plan SKU (Linux)."
  type        = string
  default     = "B1"
}

variable "acr_sku" {
  description = "Container registry SKU."
  type        = string
  default     = "Basic"
}

variable "api_image_tag" {
  description = "Tag of the API image in ACR."
  type        = string
  default     = "latest"
}

variable "frontend_image_tag" {
  description = "Tag of the frontend image in ACR."
  type        = string
  default     = "latest"
}

variable "db_share_quota_gb" {
  description = "Quota of the Azure Files share holding the SQLite database."
  type        = number
  default     = 5
}

variable "log_retention_days" {
  description = "Log Analytics retention in days."
  type        = number
  default     = 30
}

variable "tags" {
  description = "Extra tags applied to all resources."
  type        = map(string)
  default     = {}
}
