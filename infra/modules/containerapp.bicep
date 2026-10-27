param location string
param appName string
param environmentId string
param image string
param targetPort int
param registryLoginServer string
param pullIdentityId string
param databaseStorageName string = ''
param env array = []
param tags object = {}

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${pullIdentityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: environmentId
    configuration: {
      // Avoid multiple active revisions writing to the same SQLite file.
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: targetPort
        transport: 'http'
        allowInsecure: false
        traffic: [
          { weight: 100, latestRevision: true }
        ]
      }
      registries: [
        {
          server: registryLoginServer
          identity: pullIdentityId
        }
      ]
    }
    template: {
      containers: [
        {
          name: appName
          image: image
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: env
          probes: [
            {
              type: 'Readiness'
              httpGet: { path: '/', port: targetPort }
              periodSeconds: 10
              timeoutSeconds: 5
            }
          ]
          volumeMounts: empty(databaseStorageName) ? [] : [
            { volumeName: 'database', mountPath: '/app/data' }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
      volumes: empty(databaseStorageName) ? [] : [
        {
          name: 'database'
          storageType: 'AzureFile'
          storageName: databaseStorageName
        }
      ]
    }
  }
}

output fqdn string = containerApp.properties.configuration.ingress.fqdn
output appName string = containerApp.name
