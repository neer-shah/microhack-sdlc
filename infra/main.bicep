targetScope = 'resourceGroup'

param location string = resourceGroup().location

@minLength(2)
@maxLength(12)
param namePrefix string = 'octocat'

@allowed(['dev', 'test', 'prod'])
param environmentName string = 'dev'

@description('Bootstrap supporting resources before building images. Leave true for normal deployments.')
param deployApps bool = true
param imageTag string = 'latest'

var baseName = '${namePrefix}-${environmentName}'
var registryName = 'acr${uniqueString(resourceGroup().id, baseName)}'
var tags = {
  project: 'octocat-supply'
  managedBy: 'bicep'
  environment: environmentName
}

module registry 'modules/registry.bicep' = {
  name: 'registry'
  params: {
    location: location
    registryName: registryName
    tags: tags
  }
}

resource pullIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${baseName}-pull'
  location: location
  tags: tags
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: registryName
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, pullIdentity.id, 'AcrPull')
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: pullIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
  dependsOn: [registry]
}

module logs 'modules/loganalytics.bicep' = {
  name: 'loganalytics'
  params: {
    location: location
    workspaceName: '${baseName}-logs'
    tags: tags
  }
}

module environment 'modules/containerapp-env.bicep' = {
  name: 'containerapp-env'
  params: {
    location: location
    environmentName: '${baseName}-env'
    logAnalyticsWorkspaceId: logs.outputs.workspaceId
    tags: tags
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'st${uniqueString(resourceGroup().id, baseName)}'
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
  }
}

resource files 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource database 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  parent: files
  name: 'sqlite-data'
  properties: {
    shareQuota: 5
    enabledProtocols: 'SMB'
  }
}

resource managedEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: '${baseName}-env'
}

resource databaseMount 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  parent: managedEnvironment
  name: 'sqlite'
  properties: {
    azureFile: {
      accountName: storage.name
      accountKey: storage.listKeys().keys[0].value
      shareName: database.name
      accessMode: 'ReadWrite'
    }
  }
  dependsOn: [environment]
}

var frontendHost = '${baseName}-frontend.${environment.outputs.defaultDomain}'

module api 'modules/containerapp.bicep' = if (deployApps) {
  name: 'api-app'
  params: {
    location: location
    appName: '${baseName}-api'
    environmentId: environment.outputs.environmentId
    image: '${registry.outputs.loginServer}/api:${imageTag}'
    targetPort: 3000
    registryLoginServer: registry.outputs.loginServer
    pullIdentityId: pullIdentity.id
    databaseStorageName: databaseMount.name
    tags: tags
    env: [
      { name: 'PORT', value: '3000' }
      { name: 'NODE_ENV', value: 'production' }
      { name: 'DB_FILE', value: '/app/data/app.db' }
      { name: 'DB_ENABLE_WAL', value: 'false' }
      { name: 'API_CORS_ORIGINS', value: 'https://${frontendHost}' }
    ]
  }
  dependsOn: [acrPull]
}

module frontend 'modules/containerapp.bicep' = if (deployApps) {
  name: 'frontend-app'
  params: {
    location: location
    appName: '${baseName}-frontend'
    environmentId: environment.outputs.environmentId
    image: '${registry.outputs.loginServer}/frontend:${imageTag}'
    targetPort: 80
    registryLoginServer: registry.outputs.loginServer
    pullIdentityId: pullIdentity.id
    tags: tags
    env: [
      { name: 'API_HOST', value: api!.outputs.fqdn }
      { name: 'API_PORT', value: '443' }
      { name: 'API_PROTOCOL', value: 'https' }
    ]
  }
  dependsOn: [acrPull]
}

output acrName string = registry.outputs.registryName
output acrLoginServer string = registry.outputs.loginServer
output frontendUrl string = deployApps ? 'https://${frontend!.outputs.fqdn}' : ''
output apiUrl string = deployApps ? 'https://${api!.outputs.fqdn}' : ''
