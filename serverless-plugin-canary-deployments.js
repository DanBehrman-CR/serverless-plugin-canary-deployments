import fp from 'lodash'
import flattenObject from 'flat'
import CfGenerators from './lib/CfTemplateGenerators/index.js'
import { customPropertiesSchema, functionPropertiesSchema } from './configSchemas/index.js'

const slsHasConfigSchema = sls =>
  sls.configSchemaHandler &&
  sls.configSchemaHandler.defineCustomProperties &&
  sls.configSchemaHandler.defineFunctionProperties
class ServerlessCanaryDeployments {
  constructor (serverless, options) {
    this.serverless = serverless
    this.options = options
    this.awsProvider = this.serverless.getProvider('aws')
    this.naming = this.awsProvider.naming
    this.service = this.serverless.service
    this.hooks = {
      'after:aws:package:finalize:mergeCustomProviderResources': this.addCanaryDeploymentResources.bind(this)
    }
    this.addConfigSchema()
  }

  get codeDeployAppName () {
    const stackName = this.naming.getStackName()
    const normalizedStackName = this.naming.normalizeNameToAlphaNumericOnly(stackName)
    return `${normalizedStackName}DeploymentApplication`
  }

  get compiledTpl () {
    return this.service.provider.compiledCloudFormationTemplate
  }

  get withDeploymentPreferencesFns () {
    return this.serverless.service.getAllFunctions()
      .filter(name => fp.has('deploymentSettings', this.service.getFunction(name)))
  }

  get globalSettings () {
    return fp.pathOr({}, 'custom.deploymentSettings', this.service)
  }

  get currentStage () {
    return this.awsProvider.getStage()
  }

  addConfigSchema () {
    if (slsHasConfigSchema(this.serverless)) {
      this.serverless.configSchemaHandler.defineCustomProperties(customPropertiesSchema)
      this.serverless.configSchemaHandler.defineFunctionProperties('aws', functionPropertiesSchema)
    }
  }

  addCanaryDeploymentResources () {
    if (this.shouldDeployDeployGradually()) {
      const codeDeployApp = this.buildCodeDeployApp()
      const functionsResources = this.buildFunctionsResources()
      const codeDeployRole = this.buildCodeDeployRole(this.areTriggerConfigurationsSet(functionsResources))
      const executionRole = this.buildExecutionRole()
      Object.assign(
        this.compiledTpl.Resources,
        codeDeployApp,
        codeDeployRole,
        executionRole,
        ...functionsResources
      )
    }
  }

  areTriggerConfigurationsSet (functionsResources) {
    // Checking if the template has trigger configurations.
    for (const resource of functionsResources) {
      for (const key of Object.keys(resource)) {
        if (resource[key].Type === 'AWS::CodeDeploy::DeploymentGroup') {
          if (resource[key].Properties.TriggerConfigurations) {
            return true
          }
        }
      }
    }
    return false
  }

  shouldDeployDeployGradually () {
    return this.withDeploymentPreferencesFns.length > 0 && this.currentStageEnabled()
  }

  currentStageEnabled () {
    const enabledStages = fp.getOr([], 'stages', this.globalSettings)
    return fp.isEmpty(enabledStages) || fp.includes(this.currentStage, enabledStages)
  }

  buildExecutionRole () {
    const logicalName = this.naming.getRoleLogicalId()

    const inputRole = this.compiledTpl.Resources[logicalName]
    if (!inputRole) {
      return
    }
    const hasHook = fp.pipe(
      this.getDeploymentSettingsFor.bind(this),
      settings => settings.preTrafficHook || settings.postTrafficHook
    )
    const getDeploymentGroup = fp.pipe(
      this.getFunctionName.bind(this),
      this.getFunctionDeploymentGroupId.bind(this),
      this.getDeploymentGroupName.bind(this)
    )
    const deploymentGroups = fp.pipe(
      fp.filter(hasHook),
      fp.map(getDeploymentGroup)
    )(this.withDeploymentPreferencesFns)

    const outputRole = CfGenerators.iam.buildExecutionRoleWithCodeDeploy(inputRole, this.codeDeployAppName, deploymentGroups)

    return { [logicalName]: outputRole }
  }

  buildFunctionsResources () {
    return fp.flatMap(
      serverlessFunction => this.buildFunctionResources(serverlessFunction),
      this.withDeploymentPreferencesFns
    )
  }

  buildFunctionResources (serverlessFnName) {
    const functionName = this.naming.getLambdaLogicalId(serverlessFnName)
    const deploymentSettings = this.getDeploymentSettingsFor(serverlessFnName)
    const deploymentGrTpl = this.buildFunctionDeploymentGroup({ deploymentSettings, functionName })
    const deploymentGroup = this.getResourceLogicalName(deploymentGrTpl)
    const aliasTpl = this.buildFunctionAlias({ deploymentSettings, functionName, deploymentGroup })
    const functionAlias = this.getResourceLogicalName(aliasTpl)
    const lambdaPermissions = this.buildPermissionsForAlias({ functionName, functionAlias })
    const eventsWithAlias = this.buildEventsForAlias({ functionName, functionAlias })

    return [deploymentGrTpl, aliasTpl, ...lambdaPermissions, ...eventsWithAlias]
  }

  buildCodeDeployApp () {
    const logicalName = this.codeDeployAppName
    const template = CfGenerators.codeDeploy.buildApplication()
    return { [logicalName]: template }
  }

  buildCodeDeployRole (areTriggerConfigurationsSet) {
    if (this.globalSettings.codeDeployRole) return {}
    const logicalName = 'CodeDeployServiceRole'
    const template = CfGenerators.iam.buildCodeDeployRole(this.globalSettings.codeDeployRolePermissionsBoundary, areTriggerConfigurationsSet)
    return { [logicalName]: template }
  }

  buildFunctionDeploymentGroup ({ deploymentSettings, functionName }) {
    const logicalName = this.getFunctionDeploymentGroupId(functionName)
    const codeDeployGroupName = this.getDeploymentGroupName(logicalName)
    const params = {
      codeDeployAppName: this.codeDeployAppName,
      codeDeployGroupName,
      codeDeployRoleArn: deploymentSettings.codeDeployRole,
      deploymentSettings
    }
    const template = CfGenerators.codeDeploy.buildFnDeploymentGroup(params)
    return { [logicalName]: template }
  }

  buildFunctionAlias ({ deploymentSettings = {}, functionName, deploymentGroup }) {
    const { alias } = deploymentSettings
    const functionVersion = this.getVersionNameFor(functionName)
    const logicalName = `${functionName}Alias${alias}`
    const beforeHook = this.getFunctionName(deploymentSettings.preTrafficHook)
    const afterHook = this.getFunctionName(deploymentSettings.postTrafficHook)
    const trafficShiftingSettings = {
      codeDeployApp: this.codeDeployAppName,
      deploymentGroup,
      afterHook,
      beforeHook
    }
    const template = CfGenerators.lambda.buildAlias({
      alias,
      functionName,
      functionVersion,
      trafficShiftingSettings
    })
    return { [logicalName]: template }
  }

  getFunctionDeploymentGroupId (functionLogicalId) {
    return `${functionLogicalId}DeploymentGroup`
  }

  getDeploymentGroupName (deploymentGroupLogicalId) {
    return `${this.naming.getStackName()}-${deploymentGroupLogicalId}`.slice(0, 100)
  }

  getFunctionName (slsFunctionName) {
    return slsFunctionName ? this.naming.getLambdaLogicalId(slsFunctionName) : null
  }

  buildPermissionsForAlias ({ functionName, functionAlias }) {
    const permissions = this.getLambdaPermissionsFor(functionName)
    return fp.entries(permissions).map(([logicalName, template]) => {
      const templateWithAlias = CfGenerators.lambda
        .replacePermissionFunctionWithAlias(template, functionAlias)
      return { [logicalName]: templateWithAlias }
    })
  }

  buildEventsForAlias ({ functionName, functionAlias }) {
    const replaceAliasStrategy = {
      'AWS::Lambda::EventSourceMapping': CfGenerators.lambda.replaceEventMappingFunctionWithAlias,
      'AWS::ApiGateway::Method': CfGenerators.apiGateway.replaceMethodUriWithAlias,
      'AWS::ApiGatewayV2::Integration': CfGenerators.apiGateway.replaceV2IntegrationUriWithAlias,
      'AWS::ApiGatewayV2::Authorizer': CfGenerators.apiGateway.replaceV2AuthorizerUriWithAlias,
      'AWS::SNS::Topic': CfGenerators.sns.replaceTopicSubscriptionFunctionWithAlias,
      'AWS::SNS::Subscription': CfGenerators.sns.replaceSubscriptionFunctionWithAlias,
      'AWS::S3::Bucket': CfGenerators.s3.replaceS3BucketFunctionWithAlias,
      'AWS::Events::Rule': CfGenerators.cloudWatchEvents.replaceCloudWatchEventRuleTargetWithAlias,
      'AWS::Logs::SubscriptionFilter': CfGenerators.cloudWatchLogs.replaceCloudWatchLogsDestinationArnWithAlias,
      'AWS::IoT::TopicRule': CfGenerators.iot.replaceIotTopicRuleActionArnWithAlias,
      'AWS::AppSync::DataSource': CfGenerators.appSync.replaceAppSyncDataSourceWithAlias
    }
    const functionEvents = this.getEventsFor(functionName)
    const functionEventsEntries = fp.entries(functionEvents)
    const eventsWithAlias = functionEventsEntries.map(([logicalName, event]) => {
      const evt = replaceAliasStrategy[event.Type](event, functionAlias, functionName)
      return { [logicalName]: evt }
    })
    return eventsWithAlias
  }

  getEventsFor (functionName) {
    const apiGatewayMethods = this.getApiGatewayMethodsFor(functionName)
    const apiGatewayV2Methods = this.getApiGatewayV2MethodsFor(functionName)
    const apiGatewayV2Authorizers = this.getApiGatewayV2AuthorizersFor(functionName)
    const eventSourceMappings = this.getEventSourceMappingsFor(functionName)
    const snsTopics = this.getSnsTopicsFor(functionName)
    const snsSubscriptions = this.getSnsSubscriptionsFor(functionName)
    const s3Events = this.getS3EventsFor(functionName)
    const cloudWatchEvents = this.getCloudWatchEventsFor(functionName)
    const cloudWatchLogs = this.getCloudWatchLogsFor(functionName)
    const iotTopicRules = this.getIotTopicRulesFor(functionName)
    const appSyncDataSources = this.getAppSyncDataSourcesFor(functionName)
    return Object.assign(
      {},
      apiGatewayMethods,
      apiGatewayV2Methods,
      apiGatewayV2Authorizers,
      eventSourceMappings,
      snsTopics,
      s3Events,
      cloudWatchEvents,
      cloudWatchLogs,
      snsSubscriptions,
      iotTopicRules,
      appSyncDataSources
    )
  }

  getApiGatewayMethodsFor (functionName) {
    const isApiGMethod = fp.matchesProperty('Type', 'AWS::ApiGateway::Method')
    const isMethodForFunction = fp.pipe(
      fp.prop('Properties.Integration'),
      flattenObject,
      fp.includes(functionName)
    )
    const getMethodsForFunction = fp.pipe(
      fp.pickBy(isApiGMethod),
      fp.pickBy(isMethodForFunction)
    )
    return getMethodsForFunction(this.compiledTpl.Resources)
  }

  getApiGatewayV2MethodsFor (functionName) {
    const isApiGMethod = fp.matchesProperty('Type', 'AWS::ApiGatewayV2::Integration')
    const isMethodForFunction = fp.pipe(
      fp.prop('Properties.IntegrationUri'),
      flattenObject,
      fp.includes(functionName)
    )
    const getMethodsForFunction = fp.pipe(
      fp.pickBy(isApiGMethod),
      fp.pickBy(isMethodForFunction)
    )
    return getMethodsForFunction(this.compiledTpl.Resources)
  }

  getApiGatewayV2AuthorizersFor (functionName) {
    const isApiGMethod = fp.matchesProperty('Type', 'AWS::ApiGatewayV2::Authorizer')
    const isMethodForFunction = fp.pipe(
      fp.prop('Properties.AuthorizerUri'),
      flattenObject,
      fp.includes(functionName)
    )
    const getMethodsForFunction = fp.pipe(
      fp.pickBy(isApiGMethod),
      fp.pickBy(isMethodForFunction)
    )
    return getMethodsForFunction(this.compiledTpl.Resources)
  }

  getEventSourceMappingsFor (functionName) {
    const isEventSourceMapping = fp.matchesProperty('Type', 'AWS::Lambda::EventSourceMapping')
    const isMappingForFunction = fp.pipe(
      fp.prop('Properties.FunctionName'),
      flattenObject,
      fp.includes(functionName)
    )
    const getMappingsForFunction = fp.pipe(
      fp.pickBy(isEventSourceMapping),
      fp.pickBy(isMappingForFunction)
    )
    return getMappingsForFunction(this.compiledTpl.Resources)
  }

  getSnsTopicsFor (functionName) {
    const isSnsTopic = fp.matchesProperty('Type', 'AWS::SNS::Topic')
    const isMappingForFunction = fp.pipe(
      fp.prop('Properties.Subscription'),
      fp.map(fp.prop('Endpoint.Fn::GetAtt')),
      fp.flatten,
      fp.includes(functionName)
    )
    const getMappingsForFunction = fp.pipe(
      fp.pickBy(isSnsTopic),
      fp.pickBy(isMappingForFunction)
    )
    return getMappingsForFunction(this.compiledTpl.Resources)
  }

  getSnsSubscriptionsFor (functionName) {
    const isSnsSubscription = fp.matchesProperty('Type', 'AWS::SNS::Subscription')
    const isSubscriptionForFunction = fp.matchesProperty('Properties.Endpoint.Fn::GetAtt[0]', functionName)
    const getMappingsForFunction = fp.pipe(
      fp.pickBy(isSnsSubscription),
      fp.pickBy(isSubscriptionForFunction)
    )
    return getMappingsForFunction(this.compiledTpl.Resources)
  }

  getCloudWatchEventsFor (functionName) {
    const isCloudWatchEvent = fp.matchesProperty('Type', 'AWS::Events::Rule')
    const isCwEventForFunction = fp.pipe(
      fp.prop('Properties.Targets'),
      fp.map(fp.prop('Arn.Fn::GetAtt')),
      fp.flatten,
      fp.includes(functionName)
    )
    const getMappingsForFunction = fp.pipe(
      fp.pickBy(isCloudWatchEvent),
      fp.pickBy(isCwEventForFunction)
    )
    return getMappingsForFunction(this.compiledTpl.Resources)
  }

  getCloudWatchLogsFor (functionName) {
    const isLogSubscription = fp.matchesProperty('Type', 'AWS::Logs::SubscriptionFilter')
    const isLogSubscriptionForFn = fp.pipe(
      fp.prop('Properties.DestinationArn.Fn::GetAtt'),
      fp.flatten,
      fp.includes(functionName)
    )
    const getMappingsForFunction = fp.pipe(
      fp.pickBy(isLogSubscription),
      fp.pickBy(isLogSubscriptionForFn)
    )
    return getMappingsForFunction(this.compiledTpl.Resources)
  }

  getS3EventsFor (functionName) {
    const isS3Event = fp.matchesProperty('Type', 'AWS::S3::Bucket')
    const isS3EventForFunction = fp.pipe(
      fp.prop('Properties.NotificationConfiguration.LambdaConfigurations'),
      fp.map(fp.prop('Function.Fn::GetAtt')),
      fp.flatten,
      fp.includes(functionName)
    )
    const getMappingsForFunction = fp.pipe(
      fp.pickBy(isS3Event),
      fp.pickBy(isS3EventForFunction)
    )
    return getMappingsForFunction(this.compiledTpl.Resources)
  }

  getIotTopicRulesFor (functionName) {
    const isIotTopicRule = fp.matchesProperty('Type', 'AWS::IoT::TopicRule')
    const isIotTopicRuleForFunction = fp.matchesProperty(
      'Properties.TopicRulePayload.Actions[0].Lambda.FunctionArn.Fn::GetAtt[0]',
      functionName
    )
    const getMappingsForFunction = fp.pipe(
      fp.pickBy(isIotTopicRule),
      fp.pickBy(isIotTopicRuleForFunction)
    )
    return getMappingsForFunction(this.compiledTpl.Resources)
  }

  getAppSyncDataSourcesFor (functionName) {
    const isAppSyncDataSource = fp.matchesProperty('Type', 'AWS::AppSync::DataSource')
    const isAppSyncDataSourceForFunction = fp.matchesProperty(
      'Properties.LambdaConfig.LambdaFunctionArn.Fn::GetAtt[0]',
      functionName
    )
    const getMappingsForFunction = fp.pipe(
      fp.pickBy(isAppSyncDataSource),
      fp.pickBy(isAppSyncDataSourceForFunction)
    )
    return getMappingsForFunction(this.compiledTpl.Resources)
  }

  getVersionNameFor (functionName) {
    const isLambdaVersion = fp.matchesProperty('Type', 'AWS::Lambda::Version')
    const isVersionForFunction = fp.matchesProperty('Properties.FunctionName.Ref', functionName)
    const getVersionNameForFunction = fp.pipe(
      fp.pickBy(isLambdaVersion),
      fp.findKey(isVersionForFunction)
    )
    return getVersionNameForFunction(this.compiledTpl.Resources)
  }

  getLambdaPermissionsFor (functionName) {
    const isLambdaPermission = fp.matchesProperty('Type', 'AWS::Lambda::Permission')
    const isPermissionForFunction = fp.cond([
      [fp.prop('Properties.FunctionName.Fn::GetAtt[0]'), fp.matchesProperty('Properties.FunctionName.Fn::GetAtt[0]', functionName)],
      [fp.prop('Properties.FunctionName.Ref'), fp.matchesProperty('Properties.FunctionName.Ref', functionName)]
    ])

    const getPermissionForFunction = fp.pipe(
      fp.pickBy(isLambdaPermission),
      fp.pickBy(isPermissionForFunction)
    )

    return getPermissionForFunction(this.compiledTpl.Resources)
  }

  getResourceLogicalName (resource) {
    return fp.head(fp.keys(resource))
  }

  getDeploymentSettingsFor (slsFunctionName) {
    const fnDeploymentSetting = this.service.getFunction(slsFunctionName).deploymentSettings
    return Object.assign({}, this.globalSettings, fnDeploymentSetting)
  }
}

export default ServerlessCanaryDeployments
